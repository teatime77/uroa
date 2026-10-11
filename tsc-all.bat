@echo off
pushd "%~dp0"
if errorlevel 1 exit /b 1
call npm.cmd run build:all
set "build_exit_code=%errorlevel%"
popd
exit /b %build_exit_code%
