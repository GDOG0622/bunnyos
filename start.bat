@echo off
chcp 65001 >nul
title BunnyOS
cd /d "%~dp0"

REM 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [BunnyOS] 未检测到 Node.js
    echo 请先安装 Node.js v18+：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM 首次启动安装依赖
if not exist node_modules (
    echo [BunnyOS] 首次启动，正在安装依赖（约需 1-2 分钟）...
    call npm install
    if errorlevel 1 (
        echo.
        echo [BunnyOS] 依赖安装失败。请检查网络后重试。
        pause
        exit /b 1
    )
)

echo.
echo =====================================================
echo   BunnyOS
echo   http://localhost:3000/index.html
echo   关闭本窗口即可停止服务
echo =====================================================
echo.

REM 后台延迟 2 秒打开浏览器，给 node 留启动时间
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000/index.html'"

node server.js
echo.
echo [BunnyOS] 服务已停止。
pause
