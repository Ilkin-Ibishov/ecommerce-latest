@echo off
REM Run the Antigravity CLI agent headlessly on a prompt file.
REM
REM   scripts\agent\run-agent.cmd <prompt-file> [model] [effort]
REM
REM Output goes to .agent-runs\<prompt>-<timestamp>.log so a long run can be polled
REM from outside the shell that started it. The CLI waits for the turn to finish
REM (--print-timeout 0); nothing here imposes a deadline.

setlocal
set PROMPT_FILE=%~1
set MODEL=%~2
set EFFORT=%~3
if "%MODEL%"=="" set MODEL=gemini-3.8-flash-high
if "%EFFORT%"=="" set EFFORT=high

set AGY=%LOCALAPPDATA%\agy\bin\agy.exe
if not exist "%AGY%" (
  echo ERROR: agy.exe not found at %AGY%
  exit /b 1
)
if not exist "%PROMPT_FILE%" (
  echo ERROR: prompt file not found: %PROMPT_FILE%
  exit /b 1
)

if not exist ".agent-runs" mkdir ".agent-runs"
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%i
set LOG=.agent-runs\%~n1-%TS%.log

echo Running %PROMPT_FILE% on %MODEL% effort=%EFFORT%
echo Log: %LOG%

"%AGY%" -p "Read %PROMPT_FILE% and carry out exactly what it describes. Follow AGENTS.md. Commit your work as the prompt instructs." --model %MODEL% --effort %EFFORT% --mode accept-edits --dangerously-skip-permissions --print-timeout 0 > "%LOG%" 2>&1

echo Exit code: %ERRORLEVEL%
echo Output in %LOG%
endlocal
