@echo off
chcp 65001 >nul
title Creador de Contenido con IA - Helpmeagro

echo ========================================================
echo   Iniciando Creador de Contenido con IA (Helpmeagro)
echo ========================================================
echo.

cd /d "%~dp0"

:: 1. Comprobar instalacion de Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js no esta instalado o no se encuentra en el PATH.
    echo Por favor, instala Node.js desde https://nodejs.org/ para continuar.
    echo.
    pause
    exit /b 1
)

:: 2. Comprobar archivo .env en backend
if not exist "backend\.env" (
    echo [AVISO] No se encontro el archivo backend\.env
    if exist "backend\.env-example" (
        echo Creando backend\.env a partir de .env-example...
        copy "backend\.env-example" "backend\.env" >nul
        echo Archivo backend\.env creado.
    )
)

echo [1/2] Iniciando servidor Backend y Autopiloto...
cd backend

:: 3. Lanzar apertura del navegador tras 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

echo [2/2] Abriendo interfaz en http://localhost:3001
echo.
echo ========================================================
echo   Servidor activo en: http://localhost:3001
echo.
echo   Presiona Ctrl + C en esta ventana para detenerlo.
echo ========================================================
echo.

node server.js

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] El servidor finalizo con codigo de error %ERRORLEVEL%.
    pause
)
