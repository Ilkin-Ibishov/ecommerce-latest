@echo off
cd /d C:\Users\user\Documents\ecommerce-latest
echo ===NUMRUNS-IN-FILE===
findstr /n "numRuns" artifacts\store\src\__tests__\storefront-ux.property.test.ts
echo ===AGENT-RUNS-TRACKED=== (empty is correct)
git ls-files .agent-runs
echo ===LINEARITY===
git log --oneline main..chore/batch-01 --first-parent | find /c /v ""
git log --oneline chore/batch-01..main | find /c /v ""
echo ===TESTS===
call pnpm run test:unit > .agent-runs\verify3.txt 2>&1
echo EXIT=%ERRORLEVEL%
powershell -NoProfile -Command "Select-String -Path '.agent-runs\verify3.txt' -Pattern 'Test Files|Tests ' | Select-Object -Last 2 | ForEach-Object { $_.Line }"
