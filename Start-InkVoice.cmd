@echo off
if exist "%~dp0release\InkVoice\InkVoice.exe" (
  start "" "%~dp0release\InkVoice\InkVoice.exe"
  exit /b 0
)
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
  exit /b 0
)
echo InkVoice runtime was not found.
echo Run npm ci, or open InkVoice.exe in the complete portable release folder.
pause
exit /b 1
