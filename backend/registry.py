"""
Google Apps Script — device registry.
Each device registers its tunnel URL so the frontend can auto-discover it.
"""
import time
import logging
import platform
import threading
import urllib.request
import urllib.parse

log = logging.getLogger("syscontrol.registry")

GAS_URL = "https://script.google.com/macros/s/AKfycbwVtNbpmiTUMGfTVIMkhdqV0qaKsbpPuMkdaEveKvpvNDERfpWghcatvSXh2IWSqC1l/exec"


def _get(params, timeout):
    """GET GAS_URL with query params; returns HTTP status, raising on network error."""
    req = urllib.request.Request(GAS_URL + "?" + urllib.parse.urlencode(params),
                                 headers={"User-Agent": "SysControl/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def register_url(device_id, device_name, tunnel_url, password="", version="1.0.0"):
    if not GAS_URL:
        return False
    params = {
        "action": "register",
        "device_id": device_id,
        "name": device_name,
        "url": tunnel_url,
        "version": version,
        "os": platform.system() + " " + platform.release(),
        "password": password,
    }
    for attempt in range(3):
        try:
            return _get(params, 15) == 200
        except Exception as e:
            log.warning("Registry register attempt %d failed: %s", attempt + 1, e)
            if attempt < 2:
                time.sleep(2 ** attempt)
    return False


def set_offline(device_id):
    if not GAS_URL:
        return
    try:
        _get({"action": "offline", "device_id": device_id}, 10)
    except Exception:
        pass


def heartbeat_loop(device_id, device_name, get_url, password="", version="1.0.0"):
    """Send heartbeat every 3 minutes so frontend always has the latest tunnel URL."""
    def _loop():
        consecutive_failures = 0
        while True:
            time.sleep(180)
            url = get_url()
            if not url:
                continue
            try:
                params = {
                    "action": "heartbeat",
                    "device_id": device_id,
                    "name": device_name,
                    "url": url,
                    "version": version,
                    "os": platform.system() + " " + platform.release(),
                    "password": password,
                }
                status = _get(params, 15)
                if status == 200:
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1
                    log.warning("Heartbeat returned %d", status)
            except Exception as e:
                consecutive_failures += 1
                log.warning("Heartbeat failed (%d consecutive): %s", consecutive_failures, e)
    t = threading.Thread(target=_loop, daemon=True)
    t.start()
