# Pegadinhas de ambiente — Radar Político Alagoinhas

Erros que já custaram ciclos de depuração no passado. Checar aqui antes de assumir que é um bug novo.

## Windows / PowerShell

- **PowerShell não aceita `&&`.** Rodar comandos `git add`, `git commit`, `git push` em três linhas separadas, não encadeados.
- **PowerShell `Set-Content` corrompe UTF-8** em arquivos com acentos. Usar escrita de arquivo via Python, ou `-Encoding UTF8` explícito.
- Ambiente principal de trabalho: Windows, usuário `rober`, path `C:\Users\rober\radar-politico`. Mac é secundário.
- Se `code` (VS Code) não for reconhecido no terminal, abrir via `notepad arquivo.py` como alternativa.

## GitHub Actions / secrets

- Os nomes dos secrets no repositório **não seguem o padrão óbvio** — mapear explicitamente no YAML:
  - `GOOGLE_SA_JSON` (não `GOOGLE_CREDENTIALS`)
  - `GOOGLE_SHEET_ID` (não `SPREADSHEET_ID`)
  - `EVOLUTION_GROUP_ID` (não `WHATSAPP_NUMBER`)
- Cron do `radar.yml` roda 2x/dia: `0 9 * * *` (6h BRT) e `0 20 * * *` (17h BRT). Os horários no cron estão em UTC, não BRT — cuidado ao editar.

## Apify

- Scraper de posts: `apify~instagram-post-scraper`, usa o campo `username` (não `directUrls`).
- Scraper de comentários: `apify~instagram-comment-scraper`, usa `directUrls` (não `username`).
- Parâmetro `memory` vai como **query parameter**, não no corpo da requisição.
- Créditos são o recurso mais escasso do projeto — evitar rodar o pipeline completo repetidamente só para testar uma hipótese; usar flags de teste isoladas (ver `CLAUDE.md`).

## Google Sheets

- `get_all_records()` para na primeira linha em branco — dados precisam ser contíguos, sem lacunas.
- Duas linhas de cabeçalho na aba Radar quebram a leitura — deve haver só uma.
- Colunas sem nome no cabeçalho (ex: J e K vazias) fazem `curtidas`/`comentarios_count` aparecerem como zero mesmo com dados corretos.

## Deduplicação

- O pipeline descarta posts cuja URL já existe no banco **antes** de rodar o filtro de relevância. Se aparecer "0 posts relevantes", checar primeiro se é deduplicação (posts já existentes), não o filtro de keywords.
- Para forçar reprocessamento ignorando a deduplicação: `python agora.py --reprocessar`.
- Para testar o filtro de relevância isoladamente sem depender de posts novos: `python agora.py --teste-filtro`.

## Identificadores do projeto

- Google Sheets ID: `1ERLkUh2IYL1UbQCgmDaKtZb5EybgjDnFVSFlEY3CeDw`
- Service account: `radar-politico@radar-politico-496301.iam.gserviceaccount.com`
- Modelo Anthropic usado no pipeline: `claude-haiku-4-5-20251001`
- Repositório: `robermed-tech/radar-politico-alagoinhas` (privado)
