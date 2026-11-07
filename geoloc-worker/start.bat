@echo off
rem Osintfront geolocation worker - double-click to run.
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Fill in .env (opened in Notepad), save it, then run start.bat again.
  notepad .env
  pause
  exit /b
)
if not exist .venv (
  echo Creating Python environment - first run takes a few minutes...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python worker.py %*
pause
