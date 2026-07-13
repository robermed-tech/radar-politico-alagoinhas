# Clima por período (dia/semana/mês) + evidência dos alertas

Data: 2026-07-13

## Problema

O ClimaPage já tem um seletor de período (24h / 7 dias / 30 dias) que recalcula
os números (IAD, distribuição de sentimento, volume) no cliente a partir dos
posts filtrados. Mas dois blocos importantes da tela **não** variam com esse
seletor, porque são gerados uma única vez por execução do pipeline e guardados
por dia (`tenant, dia`), sem noção de janela:

- **Diagnóstico** (`ai_briefings.diagnostico`) — texto qualitativo gerado por
  IA a partir *apenas dos posts coletados naquele run* (`agora.py`,
  `gerar_briefing_estrategico`). Trocar de aba muda o título ("Clima da
  semana"), mas o texto abaixo continua sendo a análise do dia.
- **Temas que merecem atenção** (`ai_briefings.alertas`) — mesma origem, mesmo
  problema.
- **Rótulo do topo pro usuário comum** (`boletins.condicao`, via
  `dashboard_public`) — também gerado 1x por dia (`gravar_boletim_climatico`),
  sem score numérico exposto (design intencional do RBAC). Afeta só usuário
  não-admin, que não vê o IAD calculado no cliente.

Além disso, os alertas em "Temas que merecem atenção" não têm nenhum link para
os comentários que embasaram a conclusão da IA — o usuário não consegue
verificar a origem do alerta.

## Escopo

1. `ai_briefings` e `boletins` passam a ter uma variante por período
   (`dia` / `semana` / `mes`).
2. Boletim (rótulo do topo, sem custo de IA) é recalculado nas 3 variantes a
   cada execução do pipeline (2x/dia) — é só média sobre histórico já
   disponível em `daily_metrics`.
3. Diagnóstico + alertas (com custo de IA, Sonnet) são gerados 1x/dia para
   semana e mês (só no run da manhã), e continuam 2x/dia para o dia — mesma
   cadência de hoje.
4. Cada item de "Temas que merecem atenção" ganha um botão que abre um modal
   com os comentários reais (texto, autor, curtidas, sentimento) que embasam
   aquele tema, filtrados pelo mesmo período selecionado.

Fora de escopo: geração sob demanda (ao vivo) ao trocar de aba — descartada
por custo (uma chamada Sonnet por visita) e latência.

## 1. Schema (Supabase)

Nova migration `supabase/migrations/004_periodo_clima.sql`:

```sql
ALTER TABLE ai_briefings ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'dia'
  CHECK (periodo IN ('dia','semana','mes'));
-- upsert key passa de (tenant,dia) para (tenant,dia,periodo)

ALTER TABLE boletins ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'dia'
  CHECK (periodo IN ('dia','semana','mes'));
-- upsert key passa de (tenant,dia) para (tenant,dia,periodo)
```

`dashboard_public` (view que expõe boletim sem score pro usuário comum) precisa
incluir `periodo` no SELECT.

Mudança é aditiva: linhas existentes recebem `periodo='dia'` via DEFAULT — nada
quebra para código que já lê essas tabelas assumindo uma linha por dia.

## 2. Backend — boletim (sem custo de IA)

`gerar_boletim()` (`boletim.py`) já é puro e recebe `risco`/`serie_7d` como
parâmetro — não muda. Só `gravar_boletim_climatico()` (`agora.py`) passa a
chamá-la 3x por execução, reaproveitando o `daily_metrics` que já busca 30 dias
de histórico:

- **dia**: como hoje — `risco` = risco do dia, `serie_7d` = últimos 7 dias.
- **semana**: `risco` = média do risco dos últimos 7 dias; `serie_7d` mantém a
  série diária (contexto de tendência).
- **mês**: `risco` = média do risco dos últimos 30 dias; `serie_7d` idem.

`frentes` e `alerta_ativo` (post que disparou alerta) são os mesmos nas 3
variantes — representam "o que está acontecendo agora", não fazem sentido
diluídos por período. Histórico curto (tenant novo, <7 dias) não quebra: a
variante correspondente usa o que houver disponível.

## 3. Backend — diagnóstico + alertas (com IA)

`gerar_briefing_estrategico(posts_analisados)` (`agora.py:2170`) é refatorado
num núcleo genérico `_gerar_briefing(posts, periodo, dia)` que aceita qualquer
lista de posts com os campos já usados hoje (`tema`, `score_risco`,
`sentimento_post`, `comentarios_destaque`, `queixa_dominante`,
`elogio_dominante`).

- **dia**: chama com `posts_analisados` (só os posts deste run) — sem mudança
  de comportamento, roda nos 2 runs/dia.
- **semana/mês**: nova função `buscar_posts_periodo(dias)` consulta
  `_supabase_get("posts", "tenant=eq...&data_post=gte.<cutoff>&select=...")`
  puxando o histórico real da tabela `posts`. Roda só no run da manhã (mesmo
  guard `hora_utc in (11, 12)` que já existe para o briefing matinal) — 1x/dia
  cada, para não duplicar custo de IA à toa.
- Prompt (`PROMPT_BRIEFING`) idêntico, só o cabeçalho de contexto muda de
  "INDICES DO DIA" para "INDICES DA SEMANA" / "INDICES DO MES", para a IA não
  descrever a janela errada.
- Grava em `ai_briefings` com o `periodo` correspondente. Histórico
  insuficiente (tenant novo) → pula geração com log, sem quebrar o run.

## 4. Frontend — leitura por período

`lib/data.ts`:
- `fetchBriefing(periodo: "dia" | "semana" | "mes")` — filtro
  `&periodo=eq.${periodo}` na query REST.
- `fetchBoletimByRole(isAdmin, periodo)` — mesmo filtro; `select` inclui
  `periodo`.

`pages/ClimaPage.tsx`:
- `periodoParaChave(dias)` mapeia 1→"dia", 7→"semana", 30→"mes".
- `queryKey` de `briefing` e `boletim` inclui o período — cada aba fica
  cacheada separadamente pelo React Query (troca de aba já visitada é
  instantânea).
- `DiagnosticoCard` e `TemasEmCrise` passam a refletir o período selecionado.
- Sem dado para aquele período (recém-habilitado, ou tenant com pouco
  histórico) → mensagem explícita ("Análise da semana ainda não disponível —
  dados insuficientes"), nunca mostra o diagnóstico de outro período
  disfarçado.

## 5. Evidência dos comentários

`lib/data.ts`: `fetchComentariosPorTema` ganha parâmetros opcionais
`(tema?: string, desde?: string, limit = 500)`, filtrando por
`tema=eq.` e `data_comentario_ts=gte.` no servidor (mesmo padrão já usado em
`fetchSubtemasRecentes`).

Novo componente `EvidenciaComentariosModal` (mesmo padrão de portal usado em
`components/AlertaCrise.tsx`):
- Aberto por um botão "Ver comentários" em cada item de `TemasEmCrise`.
- Busca comentários do tema daquele item, filtrados pelo `desde` do período
  selecionado no ClimaPage — a evidência bate com a janela que gerou o alerta.
- Lista ordenada por curtidas: texto, autor, curtidas, badge de sentimento.
- Vazio: "Nenhum comentário específico deste tema no período — o alerta se
  baseia no conjunto geral de posts."

## 6. Erros e testes

- Toda geração nova roda dentro do `_safe(...)` já existente no pipeline —
  falha numa variante não derruba as demais nem o run.
- Nova flag de teste isolado: `python agora.py --testar-briefings-periodo` —
  roda só os geradores de boletim/briefing pra semana e mês a partir do
  histórico já no Supabase, sem coletar posts novos (zero custo Apify).
- Frontend: `npx tsc --noEmit` + verificação manual no browser (trocar as 3
  abas, abrir "Ver comentários").
- Projeto não tem suíte de testes Python automatizada hoje — mantém esse
  padrão, sem introduzir framework novo.
