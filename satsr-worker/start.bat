@echo off
rem Osintfront satellite enhance worker - double-click to run.
cd /d "%~dp0"

if exist .env goto have_env
copy .env.example .env >nul
echo Fill in SUPABASE_SERVICE_KEY in .env - it opens in Notepad - save it, then run start.bat again.
notepad .env
pause
exit /b

:have_env
if exist .venv\Scripts\python.exe goto run
echo Creating Python environment - first run takes several minutes...
py -3.12 -m venv .venv 2>nul
if not exist .venv\Scripts\python.exe py -3.11 -m venv .venv 2>nul
if not exist .venv\Scripts\python.exe py -3 -m venv .venv 2>nul
if not exist .venv\Scripts\python.exe python -m venv .venv
if not exist .venv\Scripts\python.exe goto no_python
.venv\Scripts\python -m pip install --upgrade pip
rem PyTorch first: the CUDA build when an NVIDIA card answers, otherwise the (smaller) CPU build.
nvidia-smi >nul 2>&1
if errorlevel 1 goto torch_cpu
echo NVIDIA graphics card found - installing PyTorch with CUDA.
.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cu124
if errorlevel 1 goto install_failed
goto torch_done
:torch_cpu
echo No NVIDIA graphics card found - installing PyTorch for the CPU.
.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 goto install_failed
:torch_done
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 goto install_failed

:run
.venv\Scripts\python worker.py %*
pause
exit /b

:no_python
echo.
echo Python was not found. Install Python 3.12 from https://www.python.org/downloads/
echo During setup tick "Add python.exe to PATH", then run start.bat again.
pause
exit /b

:install_failed
echo.
echo Installing the Python packages failed - see the messages above.
rmdir /s /q .venv
pause
exit /b
