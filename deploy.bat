@echo off
echo.
echo ==========================================
echo  RADAR POLITICO — Deploy completo
echo ==========================================
echo.

cd /d "C:\Users\rober\radar-politico"

echo [1/3] Adicionando arquivos ao git...
git add radar_politico_alagoinhas.html radar_v2.html agora.py

echo [2/3] Commit e push para GitHub...
git commit -m "deploy: atualiza dashboard %DATE% %TIME:~0,5%"
git push

echo [3/3] Publicando no Surge (radar-politico-alg.surge.sh)...
surge . radar-politico-alg.surge.sh

echo.
echo ==========================================
echo  Deploy concluido!
echo  URL: https://radar-politico-alg.surge.sh
echo ==========================================
pause
