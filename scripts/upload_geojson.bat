@echo off
REM ========================================
REM CampusGeo GeoJSON Upload Script
REM ========================================
REM 用途：将转换后的 GeoJSON 文件上传到 S3
REM 使用：双击运行或在命令行执行
REM ========================================

setlocal

REM 配置
set BUCKET=campusgeo-geodata-491117467175
set REGION=us-east-1
set SOURCE_DIR=gis_output\geojson

echo.
echo ============================================
echo CampusGeo GeoJSON Upload Tool
echo ============================================
echo.
echo Bucket: %BUCKET%
echo Region: %REGION%
echo Source: %SOURCE_DIR%
echo.

REM 检查 AWS CLI
where aws >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: AWS CLI not found. Please install it first.
    pause
    exit /b 1
)

REM 检查源目录
if not exist "%SOURCE_DIR%" (
    echo ERROR: Source directory not found: %SOURCE_DIR%
    pause
    exit /b 1
)

REM 显示将要上传的文件
echo Files to upload:
echo ----------------------------------------
dir /b "%SOURCE_DIR%\*.geojson"
echo ----------------------------------------
echo.

REM 确认上传
set /p CONFIRM="Continue with upload? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Upload cancelled.
    pause
    exit /b 0
)

echo.
echo Uploading files...
echo.

REM 执行同步上传
aws s3 sync "%SOURCE_DIR%" s3://%BUCKET%/layers/ ^
    --region %REGION% ^
    --exclude "*.xml" ^
    --exclude "*.cpg" ^
    --exclude "*.parquet" ^
    --exclude "*.lock" ^
    --delete

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo Upload completed successfully!
    echo ========================================
    echo.
    echo View files in S3:
    aws s3 ls s3://%BUCKET%/layers/ --region %REGION% --human-readable
) else (
    echo.
    echo ERROR: Upload failed with error code %errorlevel%
)

echo.
pause
