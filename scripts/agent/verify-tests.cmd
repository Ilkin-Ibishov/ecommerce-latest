@echo off
cd /d C:\Users\user\Documents\ecommerce-latest
call pnpm test > .agent-runs\test-output.txt 2>&1
echo EXIT=%ERRORLEVEL%
echo ===TAIL===
powershell -NoProfile -Command "Get-Content '.agent-runs\test-output.txt' -Tail 30"
