@echo off
echo.
echo ==========================================
echo  VIRATEMPO (app novo) — Deploy MANUAL
echo  (fallback — o CI ja publica isto sozinho
echo   a cada push em main que toque radar-app/**,
echo   ver .github/workflows/deploy.yml)
echo ==========================================
echo.

cd /d "C:\Users\rober\radar-politico\radar-app"

echo [1/3] Build (Vite + TypeScript)...
call npm run build
if errorlevel 1 (
  echo.
  echo  BUILD FALHOU. Deploy abortado. Nada foi publicado.
  pause
  exit /b 1
)

echo [2/3] Preparando fallback de rotas (SPA)...
copy /Y dist\index.html dist\200.html >nul

echo [3/3] Publicando em viratempo.surge.sh...
call surge dist viratempo.surge.sh

echo.
echo ==========================================
echo  Deploy concluido!
echo  URL: https://viratempo.surge.sh
echo ==========================================
pause
