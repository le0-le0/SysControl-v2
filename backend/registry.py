"""
Google Apps Script — device registry.
Each device registers its tunnel URL so the frontend can auto-discover it.
"""
import time
import logging
import platform
import threading
import requests

log = logging.getLogger("syscontrol.registry")

GAS_URL = "https://script.google.com/macros/s/AKfycbwVtNbpmiTUMGfTVIMkhdqV0qaKsbpPuMkdaEveKvpvNDERfpWghcatvSXh2IWSqC1l/exec"


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
            r = requests.get(GAS_URL, params=params, timeout=15)
            return r.status_code == 200
        except Exception as e:
            log.warning("Registry register attempt %d failed: %s", attempt + 1, e)
            if attempt < 2:
                time.sleep(2 ** attempt)
    return False


def set_offline(device_id):
    if not GAS_URL:
        return
    try:
        requests.get(
            GAS_URL,
            params={"action": "offline", "device_id": device_id},
            timeout=10,
        )
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
                r = requests.get(GAS_URL, params=params, timeout=15)
                if r.status_code == 200:
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1
                    log.warning("Heartbeat returned %d", r.status_code)
            except Exception as e:
                consecutive_failures += 1
                log.warning("Heartbeat failed (%d consecutive): %s", consecutive_failures, e)
    t = threading.Thread(target=_loop, daemon=True)
    t.start()
