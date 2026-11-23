"""Text-to-Speech (offline, Windows SAPI) + Live Microphone streaming."""
import io
import wave
import queue
import platform
import subprocess
import threading

try:
    import sounddevice as sd
    SOUNDDEVICE_OK = True
except Exception:
    SOUNDDEVICE_OK = False

_tts_lock = threading.Lock()
_NO_WINDOW = 0x08000000 if platform.system() == "Windows" else 0

# Mic state
_mic_stream = None
_mic_queue = queue.Queue(maxsize=50)
_mic_rate = 16000
_mic_channels = 1


def speak(text, rate=175):
    # Windows SAPI via PowerShell; text goes over stdin so nothing is shell-escaped.
    # SAPI Rate is -10..10; map from words-per-minute (pyttsx3 default was 175).
    sapi_rate = max(-10, min(10, round((rate - 175) / 20)))
    ps = ("[Console]::InputEncoding=[System.Text.Encoding]::UTF8;"
          "Add-Type -AssemblyName System.Speech;"
          "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
          "$s.Rate=%d;"
          "$s.Speak([Console]::In.ReadToEnd())" % sapi_rate)

    def _do():
        with _tts_lock:
            si = None
            if platform.system() == "Windows":
                si = subprocess.STARTUPINFO()
                si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                si.wShowWindow = 0
            try:
                p = subprocess.Popen(
                    ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, creationflags=_NO_WINDOW, startupinfo=si)
                p.communicate(text.encode("utf-8"), timeout=300)
            except Exception:
                pass
    threading.Thread(target=_do, daemon=True).start()
    return True


def mic_start(sample_rate=16000, channels=1):
    global _mic_stream, _mic_rate, _mic_channels
    if not SOUNDDEVICE_OK:
        return {"ok": False, "error": "sounddevice not available"}
    if _mic_stream is not None:
        return {"ok": True, "sample_rate": _mic_rate}
    _mic_rate = sample_rate
    _mic_channels = channels

    while not _mic_queue.empty():
        try:
            _mic_queue.get_nowait()
        except queue.Empty:
            break

    def callback(indata, frames, time_info, status):
        pcm = (indata * 32767).astype("int16").tobytes()
        try:
            _mic_queue.put_nowait(pcm)
        except queue.Full:
            try:
                _mic_queue.get_nowait()
                _mic_queue.put_nowait(pcm)
            except queue.Empty:
                pass

    try:
        _mic_stream = sd.InputStream(
            samplerate=_mic_rate,
            channels=_mic_channels,
            dtype="float32",
            blocksize=int(_mic_rate * 0.1),
            callback=callback,
        )
        _mic_stream.start()
        return {"ok": True, "sample_rate": _mic_rate}
    except Exception as e:
        _mic_stream = None
        return {"ok": False, "error": str(e)}


def mic_chunk(max_blocks=5):
    try:
        pcm = _mic_queue.get(timeout=1)
    except queue.Empty:
        return None
    # Coalesce up to max_blocks (~500ms) of already-queued audio into one response,
    # so each HTTP round-trip carries more audio and the stream survives tunnel
    # latency without the queue backing up and dropping blocks (choppy audio).
    for _ in range(max_blocks - 1):
        try:
            pcm += _mic_queue.get_nowait()
        except queue.Empty:
            break
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(_mic_channels)
        wf.setsampwidth(2)
        wf.setframerate(_mic_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def mic_stop():
    global _mic_stream
    if _mic_stream:
        _mic_stream.stop()
        _mic_stream.close()
        _mic_stream = None
    while not _mic_queue.empty():
        try:
            _mic_queue.get_nowait()
        except queue.Empty:
            break
    return {"ok": True}


def mic_available():
    return SOUNDDEVICE_OK
