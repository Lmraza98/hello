@echo on
setlocal EnableExtensions

echo step1
cd /d C:\Users\lmraz\Hello
echo step2

set "BACKEND_ALREADY_RUNNING="
echo step3
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":8000" ^| findstr /c:"LISTENING"') do (
  echo found backend pid %%p
  set "BACKEND_ALREADY_RUNNING=1"
)
echo step4
if defined BACKEND_ALREADY_RUNNING goto :eof
echo step5

if exist "venv\Scripts\activate.bat" (
  echo step6
  call "venv\Scripts\activate.bat"
)
echo step7

if not exist "ui\\dist\\NUL" (
  echo step8
  pushd "ui"
  if not exist "node_modules\\NUL" (
    echo step9
    call npm install
  )
  echo step10
  call npm run build
  popd
)
echo step11

set "BRIDGE_ALREADY_RUNNING="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":9223" ^| findstr /c:"LISTENING"') do (
  echo found bridge pid %%p
  set "BRIDGE_ALREADY_RUNNING=1"
)
echo step12
if defined BRIDGE_ALREADY_RUNNING goto :start_backend

echo step13
start /min "OpenClaw Browser Bridge" cmd /c ^
  "cd /d C:\Users\lmraz\Hello && node --import tsx scripts\openclaw_browser_bridge.ts"

:start_backend
echo step14
start /min "Hello Backend" cmd /c ^
  "cd /d C:\Users\lmraz\Hello && python -m uvicorn api.main:app --host 127.0.0.1 --port 8000"

echo step15
goto :eof

