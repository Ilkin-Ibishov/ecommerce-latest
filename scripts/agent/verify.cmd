@echo off
REM Independent verification of an agent's claims. Run from the repo root.
cd /d C:\Users\user\Documents\ecommerce-latest

echo ===FALLBACK-GREP===
findstr /s /n /i "fallback-dev-secret" artifacts\*.ts lib\*.ts 2>nul
echo (empty above means the fallback string is gone)

echo.
echo ===INVARIANTS===
call node scripts\audit\check-invariants.mjs

echo.
echo ===NODE_MODULES===
if exist node_modules (echo present) else (echo MISSING - install needed)

echo.
echo ===TYPECHECK===
call pnpm run typecheck

echo.
echo ===DONE===
