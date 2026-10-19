"""
Config storage using Windows Credential Manager (keyring).
No .env files — all secrets stored encrypted by the OS.
Zero-config: auto-setup on first run using hostname.
"""
import json
import uuid
import secrets
import threading
import platform

import keyring
import bcrypt

SERVICE = "SysControl"
OS = platform.system()

_cache = None
_cache_lock = threading.Lock()


def get_config():
    global _cache
    with _cache_lock:
        if _cache is not None:
            return _cache
    raw = keyring.get_password(SERVICE, "config")
    if raw:
        cfg = json.loads(raw)
        with _cache_lock:
            _cache = cfg
        return cfg
    return None


def save_config(cfg):
    global _cache
    keyring.set_password(SERVICE, "config", json.dumps(cfg))
    with _cache_lock:
        _cache = cfg


def is_configured():
    return get_config() is not None


def auto_setup():
    """Zero-config setup: hostname as device name, random password, random JWT secret."""
    device_name = platform.node() or "Unknown-PC"
    password = secrets.token_urlsafe(16)
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    device_id = uuid.uuid4().hex[:12]
    jwt_secret = secrets.token_hex(32)
    cfg = {
        "password_hash": hashed,
        "password_plain": password,
        "device_name": device_name,
        "device_id": device_id,
        "jwt_secret": jwt_secret,
        "version": "1.0.0",
    }
    save_config(cfg)
    return cfg


def get_password():
    cfg = get_config()
    return cfg.get("password_plain", "") if cfg else ""


def reset_password():
    """Regenerate password and store plaintext. Used when migrating old configs."""
    cfg = get_config()
    if not cfg:
        return ""
    password = secrets.token_urlsafe(16)
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    cfg["password_hash"] = hashed
    cfg["password_plain"] = password
    if "jwt_secret" not in cfg:
        cfg["jwt_secret"] = secrets.token_hex(32)
    save_config(cfg)
    return password


def verify_password(password):
    cfg = get_config()
    if not cfg:
        return False
    try:
        return bcrypt.checkpw(password.encode(), cfg["password_hash"].encode())
    except (ValueError, TypeError):
        return False


def get_device_name():
    cfg = get_config()
    return cfg.get("device_name", platform.node()) if cfg else platform.node()


def get_device_id():
    cfg = get_config()
    return cfg.get("device_id", "") if cfg else ""


def get_version():
    cfg = get_config()
    return cfg.get("version", "1.0.0") if cfg else "1.0.0"


def set_version(v):
    cfg = get_config()
    if cfg:
        cfg["version"] = v
        save_config(cfg)
