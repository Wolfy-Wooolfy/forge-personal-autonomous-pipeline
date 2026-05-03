@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm install
echo Starting application...
npm start
pause
