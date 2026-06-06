@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ================================================================
:: UChicago GIS Agent - ArcGIS Pro Environment Setup
:: One-time setup script to configure Python dependencies
:: ================================================================

echo.
echo ============================================================
echo   UChicago GIS Agent - ArcGIS Pro Environment Setup
echo ============================================================
echo.

:: Standard ArcGIS Pro Python paths
set "ARCGIS_PYTHON=C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
set "ARCGIS_CONDA=C:\Program Files\ArcGIS\Pro\bin\Python\Scripts\conda.exe"

:: Check if custom path file exists (from previous manual setup)
if exist "%~dp0.arcgis_python_path" (
    set /p ARCGIS_PYTHON=<"%~dp0.arcgis_python_path"
    echo [INFO] Using custom Python path from .arcgis_python_path
)

:: ================================================================
:: Step 1: Detect ArcGIS Pro Python
:: ================================================================
echo [STEP 1] Detecting ArcGIS Pro Python environment...
echo.

if exist "%ARCGIS_PYTHON%" (
    echo [SUCCESS] Found ArcGIS Pro Python: %ARCGIS_PYTHON%
    echo.
) else (
    echo [ERROR] ArcGIS Pro Python not found at standard location:
    echo   Expected: C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe
    echo.
    echo If ArcGIS Pro is installed in a different location, please enter the full path
    echo to python.exe (or press Ctrl+C to cancel):
    echo.
    set /p CUSTOM_PATH="Python path: "

    if exist "!CUSTOM_PATH!" (
        set "ARCGIS_PYTHON=!CUSTOM_PATH!"
        echo !CUSTOM_PATH!> "%~dp0.arcgis_python_path"
        echo [SUCCESS] Custom path saved to .arcgis_python_path
        echo.
    ) else (
        echo [ERROR] Path does not exist: !CUSTOM_PATH!
        pause
        exit /b 1
    )
)

:: Display Python version
echo [INFO] Python version:
"%ARCGIS_PYTHON%" --version
echo.

:: ================================================================
:: Step 2: Check installed packages
:: ================================================================
echo [STEP 2] Checking Python dependencies...
echo.

echo [INFO] Scanning installed packages (this may take a moment)...
"%ARCGIS_PYTHON%" -m pip list > "%~dp0temp_packages.txt" 2>&1

:: Check for required packages
set "MISSING_PACKAGES="
for %%P in (geopandas fiona shapely pyarrow) do (
    findstr /i /c:"%%P" "%~dp0temp_packages.txt" >nul
    if errorlevel 1 (
        echo [MISSING] %%P
        set "MISSING_PACKAGES=!MISSING_PACKAGES! %%P"
    ) else (
        echo [OK] %%P is installed
    )
)

:: Clean up temp file
del "%~dp0temp_packages.txt" >nul 2>&1

echo.

if not defined MISSING_PACKAGES (
    echo [SUCCESS] All required packages are already installed!
    goto :create_marker
)

:: ================================================================
:: Step 3: Install missing packages
:: ================================================================
echo [STEP 3] Installing missing packages: %MISSING_PACKAGES%
echo.

:: Try conda first (recommended for ArcGIS Pro)
if exist "%ARCGIS_CONDA%" (
    echo [INFO] Installing via conda (recommended for ArcGIS Pro)...
    echo [CMD] conda install -c conda-forge%MISSING_PACKAGES% -y
    echo.

    "%ARCGIS_CONDA%" install -c conda-forge%MISSING_PACKAGES% -y

    if errorlevel 1 (
        echo.
        echo [WARNING] Conda installation failed, falling back to pip...
        echo.
        goto :install_pip
    ) else (
        echo.
        echo [SUCCESS] Packages installed via conda!
        goto :create_marker
    )
) else (
    echo [INFO] Conda not found, using pip...
    goto :install_pip
)

:install_pip
echo [INFO] Installing via pip...
echo [CMD] pip install%MISSING_PACKAGES%
echo.

"%ARCGIS_PYTHON%" -m pip install%MISSING_PACKAGES%

if errorlevel 1 (
    echo.
    echo [ERROR] Package installation failed!
    echo.
    echo Troubleshooting:
    echo 1. Check internet connection
    echo 2. Try running as Administrator
    echo 3. Manual installation:
    echo    "%ARCGIS_PYTHON%" -m pip install geopandas fiona shapely pyarrow
    echo.
    pause
    exit /b 1
)

echo.
echo [SUCCESS] Packages installed via pip!

:: ================================================================
:: Step 4: Create ready marker
:: ================================================================
:create_marker
echo.
echo [STEP 4] Finalizing setup...
echo.

:: Create marker file
echo ArcGIS Pro Python environment configured > "%~dp0.arcgis_env_ready"
echo Python path: %ARCGIS_PYTHON% >> "%~dp0.arcgis_env_ready"
echo Setup completed: %date% %time% >> "%~dp0.arcgis_env_ready"

echo [SUCCESS] Environment setup complete!
echo.

:: ================================================================
:: Summary
:: ================================================================
echo ============================================================
echo   Setup Summary
echo ============================================================
echo.
echo Python environment: %ARCGIS_PYTHON%
echo Required packages:  geopandas, fiona, shapely, pyarrow
echo Status:             READY
echo.
echo Next steps:
echo 1. Run: convert_with_arcgis.bat --list-only
echo    (to see available geodatabase layers)
echo.
echo 2. Run: convert_with_arcgis.bat --all
echo    (to convert all layers to GeoJSON)
echo.
echo 3. Run: verify_conversion.bat
echo    (to verify conversion results)
echo.
echo ============================================================
echo.

pause
exit /b 0
