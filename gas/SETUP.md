# Google Apps Script — Device Registry Setup

## Step 1: Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it **SysControl** (or any name you like)

## Step 2: Add the Apps Script

1. In the spreadsheet, go to **Extensions → Apps Script**
2. Delete any default code in the editor
3. Copy-paste the entire contents of `Code.gs` into the editor
4. Click **Save** (Ctrl+S)

## Step 3: Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Set:
   - **Description**: SysControl Device Registry
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**
5. **Authorize** when prompted (click "Advanced" → "Go to SysControl" if Google warns)
6. **Copy the Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

## Step 4: Paste the URL

### Backend
Open `backend/registry.py` and set:
```python
GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec"
```

### Frontend
Open `frontend/main.js` and set:
```javascript
const GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec";
```

Both use the **same URL**.

## Step 5: Done!

- **Backend**: Just run `python server.py` (or the .exe). No input needed — it auto-configures using the PC hostname, auto-generates password, auto-shares to registry.
- **Frontend**: Just open the website. All registered devices appear automatically.

---

## Automatic Deployment (CI/CD)

After initial setup, Apps Script code auto-deploys when you push changes to `gas/` on GitHub.

This uses `clasp` via GitHub Actions (`.github/workflows/deploy-gas.yml`). One-time setup:

1. Enable Apps Script API at https://script.google.com/home/usersettings
2. Install clasp and login locally:
   ```bash
   npm install -g @google/clasp
   clasp login
   ```
3. Add these **GitHub Secrets** (Settings → Secrets and variables → Actions):
   - `CLASP_TOKEN` — full contents of `~/.clasprc.json` (or `%USERPROFILE%\.clasprc.json` on Windows)
   - `GAS_SCRIPT_ID` — from Apps Script editor → Project Settings (gear icon) → Script ID
   - `GAS_DEPLOYMENT_ID` — from Apps Script editor → Deploy → Manage deployments → copy the ID for the active deployment

After that, every push to `gas/` auto-pushes code and updates the deployment. Same URL, no manual steps.

### Files

- `Code.gs` — the Apps Script code
- `appsscript.json` — GAS project manifest used by clasp (timezone, webapp config). Must stay in sync with the Apps Script project settings.

---

## Deploy Secret (for CI update notifications)

The CI pipeline notifies Google Sheets when a new backend release is created (adds a row to the "Updates" sheet). This requires a shared secret:

1. Go to Apps Script → Project Settings → Script Properties
2. Add property: key = `DEPLOY_SECRET`, value = any random string
3. Add the same string as GitHub Secret `GAS_DEPLOY_SECRET`
4. Add the GAS web app URL as GitHub Variable `GAS_URL`

---

## Updating the Script

If CI/CD is configured, just push changes to `gas/` on GitHub — the deployment updates automatically.

For manual updates (or first-time setup):
1. Go to Apps Script editor
2. Paste the updated code
3. Click **Deploy → Manage deployments**
4. Edit the existing deployment → set **Version** to "New version"
5. Click **Deploy**

The URL stays the same — no need to update backend/frontend.

---

## Data in Google Sheets

### Devices sheet

Auto-created on first device registration:

| device_id | name | url | version | online | last_seen | os | ip | password |

### Users sheet

Frontend login credentials (manually managed by sheet owner):

| username | password |

### Updates sheet

Tracks backend releases (rows added automatically by CI):

| version | download_url | file_name | date | notes |

You can view and edit data directly in the spreadsheet.
