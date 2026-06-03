# Radar App — Centro de Comando (Fase 1)

App React/TS/Tailwind/ECharts **paralelo** ao dashboard HTML atual.
Não altera o pipeline (`agora.py`) nem o Google Sheets. Lê do mesmo Apps Script.

## Por que existe (estratégia de risco zero)
- O HTML antigo continua no ar (Surge) e o AGORA continua escrevendo no Sheets.
- Este app nasce ao lado, na branch `feat/enterprise-app`.
- Se quiser descartar: `git checkout main` e nada do que funciona foi tocado.

## Rodar localmente
```bash
cd radar-app
cp .env.example .env        # cole a URL do Apps Script (a mesma do dashboard)
npm install
npm run dev                 # http://localhost:5180
```

## O que já faz
- **Centro de Comando**: gauges de Aprovação Digital (IAD) e Risco Político.
- **Índice de Confiança da Amostra (ICA)** com aviso de amostra insuficiente.
- Distribuição de sentimento + timeline (ECharts).
- Seletor de período 24h / 7d / 30d.
- Tema escuro profissional (design tokens do blueprint).

## Fórmulas
Implementadas em `src/lib/indices.ts` conforme `../RADAR_ENTERPRISE_BLUEPRINT.md` §4.

## Próximas fases
- **Fase 2**: AGORA passa a escrever também no Supabase (dual-write); app lê do Postgres.
- **Fase 3**: Central de Crises (Realtime), Influenciadores, Narrativas, Assistente IA.

## Estrutura
```
src/
├─ lib/      data.ts (fetch+tipos) · indices.ts (IAD/ICA/risco) · format.ts
├─ components/ Gauge.tsx · KpiStat.tsx
├─ pages/    CommandCenter.tsx
├─ App.tsx   shell + sidebar
└─ main.tsx  bootstrap + react-query
```
