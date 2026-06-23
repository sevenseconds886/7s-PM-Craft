@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PM-Craft 启动器
node launcher.js
pause
