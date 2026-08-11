@echo off
cd /d "%~dp0"
if not exist node_modules (
    echo Installing dependencies for the first time - this can take a few minutes...
    call npm install
)
echo Starting MarbleGrid...
call npm run dev
