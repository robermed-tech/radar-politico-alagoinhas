# Radar Político — Relatório Técnico de Arquitetura

> Gerado em: 2026-05-21  
> Escopo: Análise completa do repositório sem alteração de código  
> Arquivos revisados: `radar.py`, `run_pipeline.py`, `radar_politico_alagoinhas.html`, `.github/workflows/radar.yml`, `requirements.txt`, `.env.example`, `.gitignore`

---

## 1. Fluxo de Coleta de Dados

### Visão Geral do Pipeline

```
GitHub Actions (cron 08:00 BRT)
        │
        ▼
run_pipeline.py
        │
        ├─► Apify REST API → dispara actor shu8hvrXbJbY3Eb9W
        │         (18 perfis do Instagram, posts dos últimos 2 dias)
        │
        ├─► Polling a cada 30s (timeout: 45 min) aguarda SUCCEEDED
        │
        ├─► Fetch do dataset via API: /v2/datasets/{id}/items
        │
        └─► radar.py::main()
                │
                ├─► Google Sheets: busca URLs já registradas (dedup)
                │
                ├─► Para cada item novo:
                │       ├─► Filtra perfis não autorizados
                │       ├─► analyse_post() → Claude Haiku (900 tokens max)
                │       └─► append_row() → Google Sheets "Radar"
                │
                └─► Para cada perfil com posts novos:
                        ├─► analyse_profile() → Claude Haiku (450 tokens max)
                        └─► update_profile_row() → Google Sheets "Perfis"

Dashboard (radar_politico_alagoinhas.html)
        │
        └─► fetch() client-side → Google Apps Script URL (doGet)
                │
                └─► Lê Google Sheets e retorna JSON para o browser
```

### Configuração do Scraper Apify

| Parâmetro | Valor |
|-----------|-------|
| Actor | `shu8hvrXbJbY3Eb9W` (apify/instagram-scraper) |
| Perfis monitorados | 18 contas do Instagram |
| Janela de coleta | `onlyPostsNewerThan: "2 days"` |
| Limite de resultados | `resultsLimit: 200` por perfil |
| Tipo de resultado | `resultsType: "posts"` |
| Comentários | Via campo `latestComments`, máx. 15 por post |

### Modelo de Análise por Post

- **Modelo**: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- **max_tokens por post**: 900
- **max_tokens por perfil**: 450
- **Framework**: 4 dimensões — Tópico/Sentimento, Atribuição, Intensidade/Urgência, Território
- **Saída**: JSON com 10 campos (relevante, sentimento_post, sentimento_comentarios, categoria_tematica, tema, atribuicao, intensidade, urgencia, localizacao, resumo)

---

## 2. APIs Existentes

### 2.1 Apify REST API v2

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/v2/acts/{ACTOR_ID}/runs` | POST | Disparar nova coleta |
| `/v2/actor-runs/{run_id}` | GET | Verificar status do run |
| `/v2/datasets/{DATASET_ID}/items` | GET | Buscar itens coletados |

- **Autenticação**: Token como query param `?token=TOKEN` (menos seguro que Bearer header)
- **Timeout de polling**: 45 min (`timeout=2700`, `interval=30`)
- **Arquivo de controle**: `run_pipeline.py` linhas 59–102

### 2.2 Anthropic API

| Uso | Modelo | max_tokens | Arquivo |
|-----|--------|------------|---------|
| Análise de post | claude-haiku-4-5-20251001 | 900 | `radar.py:259` |
| Resumo de perfil | claude-haiku-4-5-20251001 | 450 | `radar.py:330` |

- **Autenticação**: Via `anthropic.Anthropic(api_key=...)` (client SDK)
- **Sem retry**: Falhas são capturadas em `try/except`, logadas e o post é ignorado

### 2.3 Google Sheets API v4 (via gspread)

| Operação | Método gspread | Uso |
|----------|---------------|-----|
| Abrir planilha | `gc.open_by_key()` | Uma vez por execução |
| Ler URLs (dedup) | `ws.col_values(1)` | Uma leitura de coluna inteira |
| Inserir post | `ws.append_row()` | Por post novo |
| Ler perfis | `ws.get_all_values()` | Por perfil com posts |
| Atualizar perfil | `ws.update()` | Por perfil com posts |
| Migrar schema | `ws.update_cell()` | Por coluna nova (raro) |

- **Autenticação**: Service Account via JSON file (`Credentials.from_service_account_file`)
- **Scopes**: `spreadsheets` + `drive`
- **Arquivo de credenciais**: `service_account.json` (local e GitHub Secret `GOOGLE_SA_JSON`)

### 2.4 Google Apps Script (bridge dashboard → Sheets)

- URL hardcoded no HTML do dashboard como `SCRIPT_URL`
- O script retorna JSON com todos os dados do Radar para o browser
- **Sem autenticação**: URL pública — qualquer pessoa com o link lê os dados brutos
- **Arquivo**: `radar_politico_alagoinhas.html` (linha próxima de `carregarDados`)

---

## 3. Controle de Autenticação

### Credenciais e Onde Vivem

| Credencial | Arquivo local | Secret GitHub Actions | Observações |
|-----------|---------------|----------------------|-------------|
| `ANTHROPIC_API_KEY` | `.env` ✓ gitignored | `ANTHROPIC_API_KEY` | Claude SDK |
| `APIFY_API_TOKEN` | `.env` ✓ gitignored | `APIFY_API_TOKEN` | Passado como query param |
| `GOOGLE_SA_JSON` | `service_account.json` ✓ gitignored | `GOOGLE_SA_JSON` | JSON completo da SA |
| `GOOGLE_SHEET_ID` | `.env` ✓ gitignored | `GOOGLE_SHEET_ID` | ID da planilha |
| `APIFY_DATASET_ID` | `.env` | — | Atualizado em runtime |

### Fluxo de Autenticação (GitHub Actions)

```yaml
# .github/workflows/radar.yml
echo '${{ secrets.GOOGLE_SA_JSON }}' > service_account.json  # recria o arquivo
echo "ANTHROPIC_API_KEY=..."  > .env                          # recria o .env
python run_pipeline.py
```

### Pontos de Atenção na Autenticação

1. **Apify token como query param**: `?token=TOKEN` aparece em logs de acesso de rede. Preferível usar o header `Authorization: Bearer TOKEN`.
2. **Apps Script URL pública**: A URL do Apps Script que o dashboard usa para ler dados não tem autenticação. Qualquer pessoa que abrir o HTML consegue extrair a URL e consultar os dados diretamente.
3. **`service_account.json` gerado em runtime no CI**: O arquivo é criado no runner efêmero e destruído após o job. Seguro para CI/CD; porém, o arquivo fica em texto plano no filesystem do runner durante a execução.
4. **`.gitignore` cobre apenas `.env` e `service_account.json`**: Arquivos de credenciais alternativos (ex.: `credentials.json`, `.env.local`) não estão cobertos.
5. **`load_dotenv(override=True)` em `run_pipeline.py`**: Garante que `.env` sobrescreva variáveis de ambiente do sistema — correto para CI onde o runner pode ter vars vazias.

---

## 4. Gargalos Identificados

### G1 — Chamadas Claude Sequenciais (Crítico)

```python
# radar.py:510 — dentro de for item in items:
analysis = analyse_post(client, item)  # bloqueante, sem concorrência
```

- **Impacto**: ~2–3s por chamada. Com 180 posts novos (18 perfis × ~10), o tempo de análise pode chegar a **9 minutos**.
- **Worst case**: Se `resultsLimit: 200` se materializar (200 posts × 2.5s = ~8 min de análise), somado aos ~45 min de espera do Apify e às chamadas de perfil, o pipeline pode atingir o limite de 90 min do GitHub Actions.
- **Causa**: Chamadas síncronas em loop; nenhuma paralelização com `threading`, `asyncio` ou `concurrent.futures`.

### G2 — Dedup por Leitura Total da Coluna (Crescimento Lento)

```python
# radar.py:384-385
def get_existing_urls(ws):
    url_col = ws.col_values(1)   # carrega toda a coluna em memória
    return set(url_col[1:])
```

- **Impacto atual**: Baixo (centenas de linhas).
- **Impacto futuro**: Em 2 anos com ~15 posts/dia, serão ~10.000 linhas. `col_values(1)` ainda é rápido, mas é uma leitura completa da coluna a cada execução.

### G3 — Scan Completo da Planilha por Perfil

```python
# radar.py:427-432
def update_profile_row(ws_perfis, perfil, ...):
    all_values = ws_perfis.get_all_values()      # lê toda a planilha
    for i, r in enumerate(all_values[1:], start=2):
        if r and r[0] == perfil:
            ws_perfis.update(...)
```

- **Impacto**: Chamada `get_all_values()` executada **por perfil com posts** (até 18× por run).
- **Quota da API**: Cada `get_all_values()` conta como 1 request. Com 18 perfis: 18 leituras + 18 escritas = 36 requests só para a aba Perfis.

### G4 — Ausência de Retry em Chamadas de IA

```python
# radar.py:509-514
try:
    analysis = analyse_post(client, item)
except Exception as exc:
    print(f"  ERRO na analise: {exc}")
    counters["erros"] += 1
    continue  # post é perdido nesta execução
```

- **Impacto**: Erros transitórios (timeout de rede, rate limit 429) descartam o post permanentemente naquela execução. Como o post não é gravado em `existing_urls`, ele seria coletado novamente na próxima execução — mas somente se ainda estiver dentro da janela `onlyPostsNewerThan: "2 days"`.

### G5 — Dataset ID Estático vs. Dinâmico

- O `.env` guarda um `APIFY_DATASET_ID` fixo de uma execução anterior.
- `run_pipeline.py` cria um novo dataset a cada run e sobrescreve `os.environ` em runtime, mas **não atualiza o `.env` em disco**.
- **Risco**: Se o pipeline falhar após o Apify mas antes da análise, rodar `--sem-apify` requer atualização manual do `.env` com o ID do run que falhou.

### G6 — Polling Bloqueante (45 min)

```python
# run_pipeline.py:73-102
while elapsed < timeout:
    time.sleep(interval)   # dorme 30s entre verificações
```

- **Impacto**: O GitHub Actions runner fica bloqueado aguardando. Não há problema prático (é o comportamento esperado), mas consome minutos do limite de 90 min mesmo enquanto ocioso.

---

## 5. Riscos de Escalabilidade

### R1 — Google Sheets como Banco de Dados (Limite de Células)

- **Limite**: 10 milhões de células por planilha (Google)
- **Taxa atual estimada**: ~15 posts/dia × 14 colunas = 210 células/dia
- **Limite teórico atingido em**: ~130 anos — sem problema prático
- **Problema real**: Performance de leitura/escrita via API degrada com dezenas de milhares de linhas. `col_values(1)` e `get_all_values()` ficam mais lentos.
- **Horizonte de preocupação**: ~5.000 linhas (≈ 1 ano com crescimento moderado)

### R2 — Limite de Execução do GitHub Actions (90 min)

| Fase | Tempo estimado (atual) | Tempo estimado (scaled) |
|------|----------------------|------------------------|
| Checkout + setup Python | ~1 min | ~1 min |
| Apify scraping (18 perfis) | 10–45 min | 20–45 min (mais perfis) |
| Análise Claude (pior caso) | ~8 min | ~25 min (50 perfis × 10 posts) |
| Escrita Sheets | ~2 min | ~5 min |
| **Total** | **~21–56 min** | **~51–76 min** |

- **Risco imediato**: Adição de ~10 novos perfis pode ultrapassar 90 min em dias com muita atividade.

### R3 — Rate Limits da Anthropic API (Haiku)

- Haiku Tier 1: ~50 req/min, 50.000 tokens/min
- Pipeline atual (180 posts × 900 tokens): ~162.000 tokens — **excede 50k/min se processado sem pausa**
- Na prática, o tempo de processamento distribui as requisições, mas sem rate limiting explícito, picos podem causar throttling `429`.

### R4 — Perfis Duplicados em Dois Arquivos

```python
# run_pipeline.py:28-48 — ACTOR_INPUT.directUrls (18 URLs)
# radar.py:24-46       — PROFILES_META (18 perfis)
```

- Adicionar um novo perfil **exige atualização em dois lugares**. Se um for esquecido, o perfil é coletado mas ignorado (ou vice-versa).
- Não há validação que garanta consistência entre os dois conjuntos.

### R5 — Dashboard Monolítico (HTML Único)

- Arquivo ~120KB+ com todo CSS, JS e dados de configuração inline.
- Sem módulos, sem bundler, sem tree-shaking.
- Quanto mais features, mais difícil de depurar e manter.
- Sem Service Worker nem cache: cada abertura do dashboard faz um `fetch()` ao Apps Script.

### R6 — Ausência de Alertas de Falha

- Nenhuma notificação por email/Slack/webhook se o pipeline falhar.
- A única forma de detectar falha é manualmente no GitHub Actions → "runs".
- Se o pipeline falhar por 2+ dias, posts do período perdido nunca serão coletados (janela `onlyPostsNewerThan: "2 days"` não é retroativa).

### R7 — Validação de Saída do Claude

- O JSON retornado pelo Haiku é aceito sem validação de schema.
- Valores fora do enum (ex.: `categoria_tematica: "outra"`) são gravados no Sheets sem erro.
- O dashboard filtra valores conhecidos com `legacyMap`, mas dados inesperados aparecem como vazios/undefined.

---

## 6. Mapeamento de Responsabilidades por Arquivo

| Arquivo | Responsabilidade |
|---------|-----------------|
| `run_pipeline.py` | Orquestrador: dispara Apify, aguarda, chama radar.py |
| `radar.py` | Core: fetch dataset, análise IA, escrita Sheets |
| `radar_politico_alagoinhas.html` | Dashboard: leitura e visualização via Apps Script |
| `.github/workflows/radar.yml` | Agendamento: CI/CD diário + secrets |
| `requirements.txt` | Dependências Python |
| `.env` / `service_account.json` | Credenciais (gitignored) |
| `.env.example` | Template público de configuração |

---

## 7. Recomendações Priorizadas

> **Nota**: Este relatório é descritivo. Nenhuma alteração de código foi feita.

### Prioridade Alta (impacto no prazo curto)

| # | Problema | Solução Sugerida |
|---|----------|-----------------|
| 1 | Chamadas Claude sequenciais (G1) | `concurrent.futures.ThreadPoolExecutor` com pool de 5–10 workers |
| 2 | Perfis em dois lugares (R4) | Unificar lista de URLs em `radar.py:PROFILES_META`, gerar `directUrls` programaticamente |
| 3 | Ausência de alertas (R6) | GitHub Actions: step `if: failure()` com `curl` para Slack webhook |

### Prioridade Média (qualidade e manutenção)

| # | Problema | Solução Sugerida |
|---|----------|-----------------|
| 4 | Apify token em query param (A1) | Usar header `Authorization: Bearer` via `requests.Session` |
| 5 | Retry para erros transitórios (G4) | Implementar exponential backoff com `tenacity` |
| 6 | Apps Script URL pública (A2) | Adicionar token de autenticação simples no script ou usar Identity-Aware Proxy |
| 7 | Scan completo por perfil (G3) | Cache local de `ws_perfis.get_all_values()` para reutilizar em todas as 18 chamadas |

### Prioridade Baixa (escalabilidade futura)

| # | Problema | Solução Sugerida |
|---|----------|-----------------|
| 8 | Google Sheets como DB (R1) | Migrar para Supabase/PostgreSQL quando ultrapassar 5.000 linhas |
| 9 | Dashboard monolítico (R5) | Dividir em módulos com build tool (Vite) quando > 3 devs |
| 10 | Validação de saída do Claude (R7) | Adicionar `pydantic` para validar schema do JSON antes de gravar |

---

## 8. Diagrama de Dependências

```
.env / GitHub Secrets
        │
        ├─► run_pipeline.py ──► Apify API (coleta Instagram)
        │           │
        │           └─► radar.py ──► Anthropic API (Haiku)
        │                       └─► Google Sheets API (gspread)
        │
        └─► radar_politico_alagoinhas.html ──► Google Apps Script URL
                                                        │
                                                        └─► Google Sheets (leitura)
```

---

*Relatório gerado por análise estática do código. Sem execução de testes. Sem modificação de arquivos.*
