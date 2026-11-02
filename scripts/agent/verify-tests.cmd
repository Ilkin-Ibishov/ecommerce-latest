@echo off
cd /d C:\Users\user\Documents\ecommerce-latest
call pnpm run test:unit > .agent-runs\test-unit.txt 2>&1
echo EXIT=%ERRORLEVEL%
echo ===TAIL===
powershell -NoProfile -Command "Get-Content '.agent-runs\test-unit.txt' -Tail 12"
