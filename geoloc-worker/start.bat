@echo off
rem Osintfront geolocation worker - double-click to run.
cd /d "%~dp0"

if exist .env goto have_env
copy .env.example .env >nul
echo Fill in the two keys in .env - it opens in Notepad - save it, then run start.bat again.
notepad .env
pause
exit /b

:have_env
if exist .venv\Scripts\python.exe goto run
echo Creating Python environment - first run takes a few minutes...
py -3 -m venv .venv
if not exist .venv\Scripts\python.exe python -m venv .venv
if not exist .venv\Scripts\python.exe goto no_python
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 goto install_failed

:run
.venv\Scripts\python worker.py %*
pause
exit /b

:no_python
echo.
echo Python was not found. Install it from https://www.python.org/downloads/
echo During setup tick "Add python.exe to PATH", then run start.bat again.
pause
exit /b

:install_failed
echo.
echo Installing the Python packages failed - see the messages above.
rmdir /s /q .venv
pause
exit /b
