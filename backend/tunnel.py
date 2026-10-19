"""
Cloudflare Quick Tunnel — auto-start, fully hidden, no terminal window.
"""
import re
import time
import logging
import subprocess
import platform
import threading

log = logging.getLogger("syscontrol.tunnel")

_proc = None
_url = None

OS = platform.system()
_NO_WINDOW = 0x08000000 if OS == "Windows" else 0
_si = None
if OS == "Windows":
    _si = subprocess.STARTUPINFO()
    _si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _si.wShowWindow = 0

STARTUP_TIMEOUT = 30


def start(port):
    global _proc, _url
    if _proc and _proc.poll() is None:
        return _url

    try:
        _proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            creationflags=_NO_WINDOW, startupinfo=_si,
        )

        deadline = time.monotonic() + STARTUP_TIMEOUT
        for raw_line in _proc.stdout:
            if time.monotonic() > deadline:
                log.warning("Tunnel startup timed out after %ds", STARTUP_TIMEOUT)
                break
            line = raw_line.decode(errors="ignore").strip()
            if "trycloudflare.com" in line:
                m = re.search(r"(https://[a-zA-Z0-9\-]+\.trycloudflare\.com)", line)
                if m:
                    _url = m.group(1)
                    threading.Thread(target=_drain_stdout, daemon=True).start()
                    return _url
    except FileNotFoundError:
        log.error("cloudflared not found in PATH")
        return None
    except Exception as e:
        log.error("Tunnel start failed: %s", e)
        return None
    return None


def _drain_stdout():
    """Keep reading stdout so the pipe buffer doesn't fill and block cloudflared."""
    try:
        if _proc and _proc.stdout:
            for _ in _proc.stdout:
                pass
    except Exception:
        pass


def stop():
    global _proc, _url
    if _proc and _proc.poll() is None:
        _proc.terminate()
    _proc = None
    _url = None


def get_url():
    return _url


def is_running():
    return _proc is not None and _proc.poll() is None
