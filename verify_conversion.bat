@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ================================================================
:: UChicago GIS Agent - Conversion Verification Script
:: Validates GeoJSON conversion output and displays summary
:: ================================================================

set "SCRIPT_DIR=%~dp0"
set "OUTPUT_DIR=%SCRIPT_DIR%gis_output"
set "MANIFEST=%OUTPUT_DIR%\layers_manifest.json"
set "GEOJSON_DIR=%OUTPUT_DIR%\geojson"

echo.
echo ============================================================
echo   Conversion Verification
echo ============================================================
echo.

:: ================================================================
:: Check if manifest exists
:: ================================================================
if not exist "%MANIFEST%" (
    echo [ERROR] Conversion manifest not found: %MANIFEST%
    echo.
    echo Please run convert_with_arcgis.bat first to generate GeoJSON files.
    echo.
    pause
    exit /b 1
)

echo [STEP 1] Reading conversion manifest...
echo.

:: ================================================================
:: Display manifest summary using Python JSON parsing
:: ================================================================

:: Check if Python is available
set "ARCGIS_PYTHON=C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"

if exist "%SCRIPT_DIR%.arcgis_python_path" (
    set /p ARCGIS_PYTHON=<"%SCRIPT_DIR%.arcgis_python_path"
)

if not exist "%ARCGIS_PYTHON%" (
    echo [WARNING] ArcGIS Pro Python not found, using basic file checks
    goto :basic_check
)

:: Use Python to parse JSON and display formatted summary
"%ARCGIS_PYTHON%" -c "import json, sys; manifest = json.load(open(r'%MANIFEST%', encoding='utf-8')); print(f'\n[SUCCESS] Conversion manifest loaded\n'); print(f'Source: {manifest[\"source_gdb\"]}'); print(f'Generated: {manifest[\"generated_at\"]}'); print(f'Target CRS: {manifest[\"crs\"]}\n'); print(f'{'='*60}'); print(f'  Converted Layers: {len(manifest[\"layers\"])}'); print(f'{'='*60}\n'); [print(f'{i+1}. {layer[\"layer\"]}\n   Features: {layer[\"feature_count\"]:,}\n   File size: {layer[\"geojson_kb\"]:,.1f} KB\n   Geometry: {', '.join(layer[\"geometry_types\"])}\n   Source CRS: {layer[\"source_crs\"]} -> EPSG:4326 (WGS84)\n   Path: {layer[\"geojson_rel\"]}\n') for i, layer in enumerate(manifest['layers'])]; skipped = manifest.get('skipped', []); print(f'\nSkipped layers: {len(skipped)}') if skipped else None; [print(f'  - {s[\"layer\"]}: {s.get(\"status\", \"unknown\")}') for s in skipped] if skipped else None"

if errorlevel 1 (
    echo [WARNING] Failed to parse JSON with Python, falling back to basic check
    goto :basic_check
)

goto :file_check

:: ================================================================
:: Basic file check (fallback if Python not available)
:: ================================================================
:basic_check
echo [INFO] Manifest file exists: %MANIFEST%
echo [INFO] Size:
for %%F in ("%MANIFEST%") do echo   %%~zF bytes
echo.

:: ================================================================
:: Verify GeoJSON files exist
:: ================================================================
:file_check
echo.
echo [STEP 2] Verifying output files...
echo.

if not exist "%GEOJSON_DIR%\*.geojson" (
    echo [ERROR] No GeoJSON files found in: %GEOJSON_DIR%
    echo.
    pause
    exit /b 1
)

echo [INFO] GeoJSON files in output directory:
dir /b "%GEOJSON_DIR%\*.geojson"
echo.

:: Count files
set FILE_COUNT=0
for %%F in ("%GEOJSON_DIR%\*.geojson") do (
    set /a FILE_COUNT+=1
)

echo [INFO] Total GeoJSON files: %FILE_COUNT%
echo.

:: ================================================================
:: Summary
:: ================================================================
echo ============================================================
echo   Verification Complete
echo ============================================================
echo.
echo Status: SUCCESS
echo Output directory: %OUTPUT_DIR%
echo Manifest: layers_manifest.json
echo GeoJSON files: %FILE_COUNT%
echo.
echo Next steps:
echo 1. Upload to S3 (optional):
echo    convert_with_arcgis.bat --all --upload --bucket your-bucket-name
echo.
echo 2. Verify in GIS software:
echo    - Open ArcGIS Pro
echo    - Add Data - Navigate to gis_output\geojson\
echo    - Or upload to https://geojson.io/ for quick preview
echo.
echo ============================================================
echo.

pause
exit /b 0
