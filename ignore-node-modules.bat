@echo off
REM 让 Dropbox 忽略所有 node_modules 文件夹
REM 这会大大加快同步速度，因为 node_modules 可以通过 pnpm install 重新生成

echo.
echo ========================================
echo   停止 Dropbox 同步 node_modules
echo ========================================
echo.
echo 这会让 Dropbox 忽略所有 node_modules 文件夹。
echo node_modules 可以通过 pnpm install 重新生成，不需要同步。
echo.
pause

echo.
echo 正在设置 Dropbox 忽略规则...
echo.

REM 根目录 node_modules
Set-Content -Path "%~dp0node_modules" -Stream com.dropbox.ignored -Value 1

REM 子目录 node_modules
Set-Content -Path "%~dp0apps\web\node_modules" -Stream com.dropbox.ignored -Value 1
Set-Content -Path "%~dp0backend\dev-server\node_modules" -Stream com.dropbox.ignored -Value 1
Set-Content -Path "%~dp0backend\lambdas\ai-agent\node_modules" -Stream com.dropbox.ignored -Value 1
Set-Content -Path "%~dp0infra\cdk\node_modules" -Stream com.dropbox.ignored -Value 1
Set-Content -Path "%~dp0learning-coach\node_modules" -Stream com.dropbox.ignored -Value 1

echo.
echo ✓ 完成！Dropbox 现在会忽略这些 node_modules 目录。
echo.
echo 如果需要在其他电脑上工作，运行：
echo   pnpm install
echo.
pause
