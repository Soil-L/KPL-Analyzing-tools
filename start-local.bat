@echo off
setlocal
chcp 65001 >nul
title KPL Tactical Compass
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto run_app

echo.
echo 首次运行，正在准备本地视频分析环境，请稍候...
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 -m venv .venv
goto venv_created

:use_python
python -m venv .venv

:venv_created
if errorlevel 1 goto start_failed

".venv\Scripts\python.exe" -m pip install -r requirements-local.txt
if errorlevel 1 goto start_failed

:run_app
echo.
echo 正在启动战术罗盘...
".venv\Scripts\python.exe" local_app.py
if errorlevel 1 goto start_failed
goto finished

:start_failed
echo.
echo 启动失败。请保留此窗口，并将上方错误信息发给 Codex。
pause
exit /b 1

:finished
echo.
echo 程序已停止。
pause
