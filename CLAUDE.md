# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This is an authorized remote device management tool for personal and family use. The device owner installs it themselves with full knowledge. It is functionally similar to commercial tools like TeamViewer, AnyDesk, and Prey Anti-Theft.

All devices are self-registered (owner runs the installer). No covert deployment — the tool auto-starts visibly via Task Scheduler.

## What This Is

SysControl v2 is a remote system monitoring tool for Windows. A Python HTTP backend runs on target laptops, exposes a JWT-authenticated API over Cloudflare Quick Tunnels, and a static frontend (deployed to Netlify) auto-discovers devices via a Google Apps Script web app backed by Google Sheets.

## Commands

### Development
```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python server.py              # starts on http://localhost:5000

# Frontend
cd frontend
npm install
npm run dev                   # starts Vite dev server on http://localhost:5173
```

Or use the shortcut for backend: `backend\install.bat`

### Build .exe (local)
```powershell
cd backend
build.bat                     # outputs dist\SystemMonitor.exe
```
This installs PyInstaller into the venv, bundles everything into a single windowless .exe. Hidden imports include all feature modules, cv2, numpy, and psutil.

### Release (CI/CD — preferred)
```powershell
# Edit backend/VERSION (e.g. "3.2.0" → "3.3.0"), then:
git add -A; git commit -m "Release v3.3.0"; git push
```
The workflow auto-creates the git tag, builds the .exe on a Windows runner, creates a GitHub Release with the binary, and updates the Google Sheets "Updates" tab so deployed devices discover it. No manual `git tag` needed.

### Deploy Frontend
Push to `main` — Netlify auto-builds and deploys via GitHub webhook. Config in `netlify.toml` at repo root (base: `frontend/`, build: `npm install && npm run build`, publish: `dist/`).

### Deploy Google Apps Script
Push changes to `gas/` on `main` — GitHub Actions runs `clasp push` + `clasp deploy` to update the live GAS deployment in-place. Same URL, no manual redeployment.

### No tests or linter configured.

## CI/CD (GitHub Actions)

Fully automated — just push to `main`:

| Change | Trigger | What happens |
|--------|---------|-------------|
| `frontend/**` | Netlify webhook | `npm install && npm run build` → auto-deploys `dist/` to Netlify |
| `backend/VERSION` | `release-backend.yml` | Builds .exe → creates tag → GitHub Release → updates GAS "Updates" sheet |
| `gas/**` | `deploy-gas.yml` | `clasp push` → `clasp deploy` (updates existing deployment in-place) |

### Required GitHub secrets/variables (one-time setup):
- **Secrets**: `CLASP_TOKEN`, `GAS_DEPLOY_SECRET`, `GAS_SCRIPT_ID`, `GAS_DEPLOYMENT_ID`
- **Variables**: `GAS_URL`
- **Apps Script property**: `DEPLOY_SECRET` (same value as `GAS_DEPLOY_SECRET`)

## Architecture

```
Frontend (Netlify)  <-->  Google Apps Script (device registry)  <-->  Backend (each laptop)
        \                                                              /
         \------------- direct HTTPS via tunnel ----------------------/
```

**Flow:** Backend starts → `startup.auto_setup()` registers for Windows auto-start (Task Scheduler + Registry) → auto-configures (hostname as device name, random password, random JWT secret) → spawns Cloudflare Quick Tunnel (30s timeout) → registers tunnel URL + password to Google Apps Script (with retry) → sends heartbeat every 3 minutes with fresh tunnel URL. Frontend requires user login via POST to GAS (credentials in "Users" Google Sheet). After login, frontend auto-pings all devices on load → user selects online device → auto-connects using stored password (no manual password entry) → gets JWT → all subsequent API calls go directly to the laptop over the tunnel.

### Backend (`backend/`)

Built on Python's stdlib `http.server.ThreadingHTTPServer` — no framework. All routing is manual path-matching in `do_GET`/`do_POST` inside `server.py`. Crash recovery via `safe_main()` wrapper retries forever with 10s delay. Structured logging via Python `logging` module.

- **server.py** — Main HTTP server, all route handling, embedded status page HTML, command dispatch via `_handle_cmd` (20 slash commands including `/startup`, `/screen <n>`, `/clipboard set <text>`). `GET /api/monitors` returns monitor list. `/api/screen-live` accepts `mon` query param. Zero-config: auto-setup on first run. `safe_main()` wraps `main()` for crash recovery with logged tracebacks. Graceful shutdown via `SIGINT`/`SIGTERM` handlers. Request body capped at 20 MB. JSON parse errors return 400.
- **auth.py** — JWT (HS256, 24h expiry) via PyJWT. Secret is a random 64-char hex stored in config as `jwt_secret`. Raises `RuntimeError` if no config exists (no fallback key).
- **config.py** — Stores config as JSON in Windows Credential Manager via `keyring` (service: "SysControl"). Holds bcrypt hash, plaintext password, device name/ID, JWT secret, version. Thread-safe in-memory cache avoids repeated keyring reads. `auto_setup()` runs on first launch — no user input needed. `verify_password()` catches malformed bcrypt hashes.
- **tunnel.py** — Spawns `cloudflared tunnel` as hidden subprocess, parses stdout for the `trycloudflare.com` URL. 30-second startup timeout. Drains stdout in background thread to prevent pipe buffer deadlock. Logs errors when cloudflared is missing or fails.
- **registry.py** — Google Apps Script API calls to register device URL on startup with retry (3 attempts, exponential backoff). Heartbeat every 3 minutes keeps tunnel URL fresh with failure tracking. Sets `online: false` on shutdown. `GAS_URL` must be set to the deployed web app URL.
- **updater.py** — Checks Google Sheets "Updates" tab for new versions, downloads new .exe, swaps via batch script. Bat process is fully detached (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`) so it survives the parent's `os._exit()`. `config.set_version()` is best-effort (try/except) so updates succeed even when the credential store is unavailable (locked screen, SYSTEM session). `auto_update_loop()` currently disabled (no-op). CI publishes new versions to the Updates sheet via the `publish_update` GAS action.
- **VERSION** — Plain text file containing the current version (e.g. `3.2.0`). CI reads this on push to auto-tag and release. Bump this file to trigger a new release.

### Google Apps Script (`gas/`)

- **Code.gs** — The Apps Script code deployed as a web app. Handles register, heartbeat, offline, device listing, user login (via POST body), update checking, `publish_update` (CI-triggered, writes to "Updates" sheet, requires `DEPLOY_SECRET` script property), and cleanup. Data stored in "Devices" sheet (device registry), "Users" sheet (frontend auth credentials), and "Updates" sheet (version management). `DEPLOY_SECRET` read from Script Properties at module level. Supports both GET parameters and POST form-encoded body.
- **appsscript.json** — GAS project manifest (timezone, webapp config, V8 runtime). Required by clasp for CI auto-deploy.
- **SETUP.md** — Step-by-step deployment instructions.

### Feature Modules (`backend/features/`)

Each module is self-contained with no cross-dependencies between features:

- **screen.py** — `mss` + `Pillow`. Multi-monitor support: `list_monitors()` returns index/width/height/position for each display. `screenshot_png(monitor)`, `screenshot_jpeg(quality, monitor)`, `live_frame(quality_key, monitor)` all accept a monitor index param (defaults to 1 = primary). Three quality tiers (low/med/high) with JPEG quality + scale factors. Adaptive streaming via `/api/screen-live`.
- **webcam.py** — OpenCV (`opencv-python-headless`, no ffmpeg needed). Single capture via `capture_jpeg()` and live streaming via background thread with 10ms throttle. `start_live()` waits for first frame before returning. `stop_live()` joins capture thread before releasing camera to prevent race conditions.
- **shell.py** — `subprocess.Popen(cmd, shell=True)` with thread-safe CWD tracking via `threading.Lock`. Handles `cd` as a special case.
- **files.py** — Full file operations: browse, read/write, upload/download (base64), rename, delete, mkdir. Whitelist of editable extensions. Path safety checks block access to critical OS directories (`System32`, `ProgramData`, `Program Files`). Upload capped at 15 MB. Rename rejects path separators.
- **system.py** — OS info (including CPU/RAM via psutil), public IP, clipboard read (`pyperclip.paste()`) and write (`pyperclip.copy()`), WiFi passwords (netsh export), lock screen, shutdown.
- **audio.py** — TTS via pyttsx3 (threaded), live mic via sounddevice (16kHz, 100ms blocks, WAV chunks via queue). Queue is drained on mic stop to prevent stale audio.
- **keylog.py** — pynput keyboard listener, thread-safe `deque` buffer (10K max, O(1) overflow), special key mapping.
- **startup.py** — Bulletproof Windows auto-start using dual approach: Task Scheduler (`ONLOGON`, `HIGHEST` privilege) + Registry Run key fallback. `auto_setup()` called at top of `main()` — registers silently when running as .exe. Re-registers if exe path has moved. Remote control via `/startup`, `/startup on`, `/startup off` commands.

All Windows subprocesses use `CREATE_NO_WINDOW` (0x08000000) + `STARTUPINFO(wShowWindow=0)` to run hidden.

### Frontend (`frontend/`)

Built with **Vite** + **Tailwind CSS v4** (CSS-first config, no `tailwind.config.js`). ES modules, single-page app with screen toggling via `hidden` class. Modern ES2020+ syntax.

- **main.js** — All logic (ES module, functions exposed on `window` via `Object.assign` for HTML onclick handlers): user auth via POST to GAS (login/logout), device discovery with auto-ping on load, on-demand live-ping status check, JWT auth with auto-refresh on 401 (re-authenticates with stored password, deduped via `_refreshing` promise), auto-connect using stored passwords (no password modal), 15-second `AbortSignal.timeout` on `api()`/`apiRaw()` calls, 12 overlay/modal managers, multi-monitor picker (`loadMonitors()`, `setLiveMon()`), file drag-and-drop upload onto explorer panel (with `dragCount` ref-counter to prevent flicker), clipboard menu (read remote clipboard or paste text to remote via dialog), in-app activity log (`slog(level, msg)` with 500-entry ring buffer, global `error`/`unhandledrejection` handlers, download as .txt). `GAS_URL` must be set to the deployed web app URL. Device list parsing extracted into `parseDevices()` helper. Toast notification system replaces all `alert()` calls. Promise-based custom dialog system replaces all native `confirm()` and `prompt()` calls. Debounced file explorer search. Escape key closes topmost overlay only.
- **index.html** — Single-page app UI: `<script type="module">` for Vite. Auth screen, device list, login modal, control panel with 4 command groups (Display, Audio & I/O, Info, Control) using inline SVG icons (with Log button, monitor picker buttons in live overlay), shell terminal, file explorer, file editor, live screen, live camera, live mic, keylogger, update modal, activity log overlay, lightbox, toast container. JetBrains Mono loaded from Google Fonts. SVG logos use monospace "SC" text with green stroke border.
- **style.css** — Tailwind CSS v4 with `@import "tailwindcss"`, `@theme` block for design tokens, `@apply` component classes. Terminal/cybersecurity dashboard theme: high-density, low-glare dark interface with crisp monospaced typography (JetBrains Mono / Fira Code / Cascadia Code). Green accent (`#00ff88`) with neon green status indicators. Sharp corners (2px radius), 12px base font size, tight padding throughout. Desktop sidebar layout via CSS Grid (`@media (min-width: 768px)`: 220px sidebar + flexible chat area). Component classes (toast, dialog, device-card, ex-item, sh-line, etc.) defined with `@apply` in `@layer components` so JS-created DOM elements keep short class names.
- **vite.config.js** — Vite config with `@tailwindcss/vite` plugin.
- **package.json** — Vite + Tailwind CSS v4 dev dependencies and build scripts (`dev`, `build`, `preview`).
- **public/manifest.json** — PWA manifest with inline SVG icon using monospace green-bordered "SC" logo (installable on phones). Served as static asset by Vite.

### CI/CD (`.github/workflows/`)

- **release-backend.yml** — Triggers on push to `main` when `backend/VERSION` changes. Reads version, checks if tag exists, builds .exe on `windows-latest`, creates git tag, creates GitHub Release with binary, POSTs `publish_update` to GAS to register the new version in the "Updates" sheet.
- **deploy-gas.yml** — Triggers on push to `main` when `gas/**` changes. Installs clasp, writes auth from `CLASP_TOKEN` secret, pushes code with `clasp push --force`, updates existing deployment with `clasp deploy -i $GAS_DEPLOYMENT_ID`.

### Config Files (repo root)

- **netlify.toml** — Netlify deploy config: base `frontend/`, build `npm install && npm run build`, publish `dist/`. Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- **.vscode/settings.json** — Suppresses VSCode's built-in CSS validator warnings for Tailwind CSS v4 at-rules (`@theme`, `@apply`).

## Key Design Decisions

- **Zero-config backend** — First run auto-creates config: hostname as device name, random password, random JWT secret. No setup page, no user input.
- **Auto-start on boot** — When running as .exe, automatically registers for Windows startup via Task Scheduler (primary) and Registry Run key (fallback). Zero manual action after first run.
- **Crash recovery** — `safe_main()` wraps the server entry point; if `main()` crashes, logs the full traceback, waits 10s, and retries forever. Combined with auto-start, ensures the service is always running.
- **Graceful shutdown** — `SIGINT`/`SIGTERM` trigger orderly cleanup: server stops, tunnel terminates, device marked offline in registry.
- **Structured logging** — All components log via Python's `logging` module with timestamps. HTTP request logging at DEBUG level. Errors, retries, and state changes at INFO/WARNING.
- **No .env files** — All secrets stored in Windows Credential Manager via keyring, not on disk.
- **No Telegram** — Pure HTTP+JWT replaced the v1 Telegram bot approach.
- **Google Apps Script registry** — Google Apps Script + Google Sheets serves as the device directory and user auth. "Devices" sheet stores device info + passwords (auto-shared by backend). "Users" sheet stores frontend login credentials (manually managed). "Updates" sheet stores version history (auto-populated by CI via `publish_update`).
- **Heartbeat every 3 minutes** — Backend sends tunnel URL + metadata to GAS registry periodically so the frontend always has the latest tunnel URL after restarts. Failures are tracked and logged.
- **Auto-connect, no password prompt** — Frontend auto-connects to devices using the password stored in Google Sheets. User never enters a device password. Offline devices show a clear message instead of a login form.
- **Last seen display** — Offline devices show relative time since last heartbeat (e.g., "Offline · last seen 5m ago") via `timeAgo()`.
- **JWT auto-refresh** — Frontend stores device password on `conn._password`. On 401, `_refreshToken()` re-authenticates and retries the failed request. Deduplication via `_refreshing` promise prevents parallel refresh storms.
- **15-second API timeout** — `api()` and `apiRaw()` use `AbortSignal.timeout(15000)` so dead connections fail fast instead of hanging indefinitely.
- **Multi-monitor** — Backend `screen.list_monitors()` enumerates all displays. Frontend dynamically shows a monitor picker when >1 monitor detected; `fetchFrame` passes `mon` query param.
- **Clipboard sync** — Read remote clipboard and paste text to remote clipboard. `clipboardMenu()` shows a two-step dialog (Read vs Paste To). Backend `set_clipboard()` uses `pyperclip.copy()`.
- **File drag-and-drop** — Explorer panel supports drag-and-drop file upload via `initDragDrop()` IIFE. Uses `dragCount` ref-counter to prevent child element flicker on dragenter/dragleave.
- **In-app activity log** — `slog(level, msg)` appends to a 500-entry ring buffer with timestamp. Auto-logged: every API call (path, status, timing), auth events, connect/disconnect, health transitions, uncaught errors, unhandled promise rejections. Log overlay with Save (download .txt) and Clear buttons. Session-only — no localStorage persistence.
- **Adaptive live streaming** — Both Live Screen and Live Camera use adaptive polling: next frame is fetched only after the previous one loads, with a configurable delay per quality tier. Naturally adapts to network speed — no request pileup. Live Mic uses a tight async loop (`micLoop`) — fetches the next 100ms WAV chunk immediately after the previous one arrives, with Web Audio API scheduling for gapless playback.
- **Webcam via OpenCV** — Uses `opencv-python-headless` (no ffmpeg binary needed). Two buttons: "Webcam" for instant chat screenshot, "Cam" for live camera overlay with L/M/H quality.
- **Frontend auth** — Username/password login via POST to GAS "Users" sheet. Session persists in localStorage. Only manually-added users can access the dashboard.
- **Embedded HTML** — Status page is a raw HTML string inside `server.py`, not a separate file.
- **Any unrecognized command** sent to `/api/cmd` is executed as a shell command (server.py `_handle_cmd`).
- **CORS is `*`** — Intentional, since the frontend is on a different domain (Netlify) and backend is behind a random tunnel URL.
- **Path safety** — File operations block access to critical OS directories. Uploads capped at 15 MB. Request bodies capped at 20 MB.
- **Thread safety** — Config reads are cached with a lock. Shell CWD is lock-protected. Webcam stop joins the capture thread. Keylog uses `deque` with maxlen.
- **CI/CD — zero manual releases** — Bump `backend/VERSION` and push. GitHub Actions builds the .exe, tags, creates the release, and updates the Google Sheets "Updates" tab. Frontend deploys via Netlify webhook. GAS deploys via clasp. No manual tagging, no manual uploads, no manual GAS redeployment.

## Port and Config

- Backend always binds port **5000**. On startup it kills any existing process on that port.
- Device ID is a random 12-char hex generated during auto-setup.
- JWT tokens expire after 24 hours. Frontend auto-refreshes on 401 by re-authenticating with the stored device password.
- JWT secret is a random 64-char hex stored in Windows Credential Manager (not derived from password hash). No fallback key — config must exist.
- Cloudflare tunnel URLs change on every backend restart; heartbeat every 3 minutes keeps GAS registry updated. Tunnel startup times out after 30 seconds.
- Frontend login credentials stored in "Users" sheet (columns: username, password). Users added manually by sheet owner. Login uses POST (not GET).
- Quality tiers for live screen and webcam: Low (q45, 50% scale), Med (q70, 75% scale), High (q90, full resolution).
- `backend/VERSION` file is the single source of truth for release versions. CI reads it, creates the tag, and builds the release.
- Frontend API calls have a 15-second timeout via `AbortSignal.timeout(15000)`.

## Dependencies

Backend (`requirements.txt`): mss, Pillow, keyring, pyttsx3, requests, pyperclip, pynput, sounddevice, PyJWT, bcrypt, psutil, opencv-python-headless. External binary: `cloudflared` must be in PATH for tunneling.

Frontend (`frontend/package.json` devDependencies): vite, tailwindcss (v4), `@tailwindcss/vite`. No runtime dependencies — all frontend code is vanilla JS.
