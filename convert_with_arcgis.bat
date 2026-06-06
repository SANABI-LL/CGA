@echo off
chcp 65001 >nul
setlocal

:: ================================================================
:: UChicago GIS Agent - Geodatabase Converter (ArcGIS Pro)
:: Wrapper script to run convert_gdb.py with ArcGIS Pro Python
:: ================================================================

set "ARCGIS_PYTHON=C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
set "SCRIPT_DIR=%~dp0"
set "CONVERT_SCRIPT=%SCRIPT_DIR%convert_gdb.py"

:: Check if custom Python path exists
if exist "%SCRIPT_DIR%.arcgis_python_path" (
    set /p ARCGIS_PYTHON=<"%SCRIPT_DIR%.arcgis_python_path"
)

:: ================================================================
:: Pre-flight checks
:: ================================================================

:: Check if environment setup is complete
if not exist "%SCRIPT_DIR%.arcgis_env_ready" (
    echo.
    echo [ERROR] Environment not configured!
    echo.
    echo Please run setup_arcgis_env.bat first to install required Python packages.
    echo.
    pause
    exit /b 1
)

:: Check if Python exists
if not exist "%ARCGIS_PYTHON%" (
    echo.
    echo [ERROR] ArcGIS Pro Python not found: %ARCGIS_PYTHON%
    echo.
    echo Please run setup_arcgis_env.bat to configure the environment.
    echo.
    pause
    exit /b 1
)

:: Check if convert_gdb.py exists
if not exist "%CONVERT_SCRIPT%" (
    echo.
    echo [ERROR] Conversion script not found: %CONVERT_SCRIPT%
    echo.
    echo Please ensure convert_gdb.py is in the project root directory.
    echo.
    pause
    exit /b 1
)

:: ================================================================
:: Run conversion
:: ================================================================

echo.
echo ============================================================
echo   UChicago GIS Agent - Geodatabase to GeoJSON Converter
echo ============================================================
echo.
echo [INFO] Using ArcGIS Pro Python environment
echo [INFO] Python: %ARCGIS_PYTHON%
echo.

:: Execute convert_gdb.py with all passed arguments
"%ARCGIS_PYTHON%" "%CONVERT_SCRIPT%" %*

:: Capture exit code
set EXIT_CODE=%errorlevel%

echo.

if %EXIT_CODE% equ 0 (
    echo ============================================================
    echo   Conversion completed successfully!
    echo ============================================================
    echo.
    echo Output location: %SCRIPT_DIR%gis_output\
    echo.
    echo Next steps:
    echo - Run verify_conversion.bat to check results
    echo - Open gis_output\geojson\*.geojson in ArcGIS Pro or geojson.io
    echo.
) else (
    echo ============================================================
    echo   Conversion failed (exit code: %EXIT_CODE%)
    echo ============================================================
    echo.
    echo Check the error messages above for details.
    echo.
)

exit /b %EXIT_CODE%
