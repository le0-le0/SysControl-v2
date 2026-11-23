"""Screenshot + live screen streaming using mss + Pillow (no opencv)."""
import io
import threading
import mss
from PIL import Image

QUALITY_MAP = {"low": (45, 0.5), "med": (70, 0.75), "high": (90, 1.0)}

# mss handles aren't thread-safe, so keep one instance per thread and reuse it
# instead of allocating a new screen context on every frame.
_local = threading.local()


def _sct():
    sct = getattr(_local, "sct", None)
    if sct is None:
        sct = _local.sct = mss.mss()
    return sct


def _mon_index(monitor):
    """Clamp monitor index: 0 = all monitors, 1+ = individual. Default primary (1)."""
    try:
        i = int(monitor)
    except (TypeError, ValueError):
        return 1
    if i < 0 or i >= len(_sct().monitors):
        return 1
    return i


def list_monitors():
    result = []
    for i, m in enumerate(_sct().monitors):
        if i == 0:
            continue
        result.append({"index": i, "width": m["width"], "height": m["height"],
                       "left": m["left"], "top": m["top"]})
    return result


def screenshot_png(monitor=1):
    sct = _sct()
    img = sct.grab(sct.monitors[_mon_index(monitor)])
    return mss.tools.to_png(img.rgb, img.size)


def screenshot_jpeg(quality=70, monitor=1):
    sct = _sct()
    raw = sct.grab(sct.monitors[_mon_index(monitor)])
    img = Image.frombytes("RGB", raw.size, raw.rgb)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def live_frame(quality_key="med", monitor=1):
    q, scale = QUALITY_MAP.get(quality_key, (55, 0.6))
    sct = _sct()
    raw = sct.grab(sct.monitors[_mon_index(monitor)])
    img = Image.frombytes("RGB", raw.size, raw.rgb)
    if scale < 1.0:
        w, h = img.size
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    return buf.getvalue()
