@echo off
cd /d C:\Users\user\Documents\ecommerce-latest
echo ===BRANCH===
git branch --show-current
echo ===COMMITS-SINCE-PHASE0===
git log --oneline chore/agent-workflow-phase0..HEAD
echo ===DIRTY-FILE-COUNT===
git status --porcelain > "%TEMP%\gs.txt"
find /c /v "" < "%TEMP%\gs.txt"
echo ===AGY-RUNNING===
powershell -NoProfile -Command "@(Get-Process agy -ErrorAction SilentlyContinue).Count"
echo ===RUN-LOGS===
dir /b /o-d .agent-runs\*.log
