@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   CampusGeo Learning Coach
echo   进度追踪器 Progress Tracker
echo ========================================
echo.

type data\progress.json

echo.
echo ========================================
echo.
echo 命令 Commands:
echo   show-progress.bat    - 查看当前进度 View current progress
echo   npm run track:stats  - 详细统计 Detailed stats
echo   npm run track:log    - 记录今日工作 Log today's work
echo.

pause
