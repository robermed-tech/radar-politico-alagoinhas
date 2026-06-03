# Radar Político — Blueprint Enterprise (Centro de Comando de Inteligência Política)

> Documento de arquitetura e implementação para evoluir o Radar Político de
> dashboard para **plataforma SaaS multi-tenant de inteligência política**.
> Stack-alvo: React + TypeScript + Tailwind + shadcn/ui + Apache ECharts +
> Supabase (Postgres + Auth + Realtime + Edge Functions).

---

## 0. Onde estamos vs. onde vamos

| Camada | Hoje | Alvo Enterprise |
|---|---|---|
| Ingestão | `agora.py` (Apify) 4x/dia | Mantém worker; +webhooks, +backfill, +fila |
| Análise | Claude Haiku → JSON | Mantém; +embeddings, +clustering de narrativas |
| Storage | Google Sheets | **Postgres (Supabase)** com RLS multi-tenant |
| API | Apps Script público | **Supabase REST/RPC + Edge Functions** (auth) |
| Front | HTML estático único | **React SPA** (Vite) modular |
| Auth | nenhuma | **Supabase Auth** (e-mail, OAuth, MFA) |
| Tempo real | polling 30min | **Supabase Realtime** (alertas push) |

**Princípio de migração:** o pipeline Python continua sendo a fonte da verdade
analítica. Trocamos apenas o *sink* (Sheets → Postgres) e construímos o front novo
lendo do Postgres. Zero downtime: durante a transição o AGORA escreve nos dois.

---

## 1. Identidade Visual & Design System

### Conceito
**"Radar + Clima Político + Sala de Guerra"**. Sai a estética de gradientes
saturados; entra um sistema sóbrio de *command center* com dados densos.

### Tokens (Tailwind / CSS vars)

```css
/* Tema escuro (padrão profissional) */
--bg-0:#0B0F17;  --bg-1:#121826;  --bg-2:#1A2233;  --bg-3:#232E44;
--line:#2A364E;  --line-strong:#3A496B;
--txt-1:#EAF0FA; --txt-2:#9FB0CC; --txt-3:#5F6E8C;
/* Semânticas de risco (Central de Crises) */
--risk-low:#22C55E; --risk-mod:#EAB308; --risk-high:#F97316; --risk-crit:#EF4444;
/* Marca */
--brand:#3B82F6; --brand-2:#06B6D4; --accent:#A855F7;
/* Sentimento */
--pos:#22C55E; --neu:#64748B; --neg:#EF4444;
```

- **Tema claro**: mesma escala invertida (bg `#F7F9FC`, txt `#0B1220`), contraste AA mínimo 4.5:1.
- **Tipografia**: `Inter` (UI) + `Geist Mono` / `JetBrains Mono` (números/IDs). Tabular-nums obrigatório em métricas.
- **Gradientes**: só em 1 lugar (gauge de risco). Resto = superfícies sólidas + 1px de borda.
- **Densidade**: grid de 8px, cards com `p-4`, KPIs em linha (não cards gigantes).
- **Ícone-marca**: anel de radar concêntrico com varredura (SVG animado discreto).

### Componentes base (shadcn/ui)
`Button, Card, Tabs, Badge, Tooltip, Dialog, Sheet, Command, Table (TanStack),
Select, Popover, Toast/Sonner, Skeleton, ScrollArea, Resizable, HoverCard`.

---

## 2. Arquitetura de Componentes (React/TS)

```
src/
├─ app/                         # rotas (React Router ou TanStack Router)
│  ├─ (auth)/login, /signup
│  ├─ command-center/           # 1. Centro de Comando (home)
│  ├─ approval/                 # 3+4 Índices (aprovação + confiança)
│  ├─ trends/                   # 5. Análise temporal
│  ├─ risk/                     # 2. Previsão de risco
│  ├─ crisis/                   # 10. Central de Crises
│  ├─ influencers/              # 7. Classificação de influenciadores
│  ├─ narratives/               # 8. Amplificação & origem
│  ├─ assistant/                # 9. Assistente estratégico IA
│  ├─ alerts/                   # 6. Alertas
│  └─ settings/                 # perfis monitorados, tenant, billing
│
├─ features/                    # lógica de domínio por módulo
│  ├─ approval/  hooks/ services/ types.ts
│  ├─ risk/      model.ts (fórmulas) hooks/
│  ├─ narratives/clustering.ts
│  └─ ...
│
├─ components/
│  ├─ charts/                   # wrappers ECharts (tree-shaken)
│  │   ├─ RiskGauge.tsx  ApprovalTimeline.tsx  SentimentStacked.tsx
│  │   ├─ NarrativeFlow.tsx (sankey)  InfluencerScatter.tsx  Heatmap.tsx
│  ├─ kpi/ KpiStat.tsx  Delta.tsx  Sparkline.tsx
│  ├─ crisis/ CrisisBadge.tsx  CrisisTimeline.tsx
│  ├─ layout/ Sidebar.tsx  Topbar.tsx  CommandK.tsx
│  └─ ui/ (shadcn)
│
├─ lib/
│  ├─ supabase.ts  (client + types gerados)
│  ├─ echarts.ts   (registro de componentes usados)
│  ├─ theme.ts     (light/dark provider)
│  └─ format.ts    (pt-BR números, datas, %)
│
├─ stores/ (Zustand)  ui, filters, realtime
└─ types/ database.ts (gerado: supabase gen types)
```

### Padrões
- **Data fetching**: TanStack Query + Supabase. `staleTime` por módulo; Realtime invalida queries.
- **Charts**: 1 wrapper por tipo, `option` memoizada, `notMerge` controlado, tema injetado.
- **Estado de filtro global** (período, perfil, tenant) em Zustand; persiste em URL (`?range=30d&profile=...`).
- **Acessibilidade**: cada chart tem `<table>` alternativa em `<details>` (data-table rule).

---

## 3. Modelo de Dados (Postgres / Supabase)

Multi-tenant por `tenant_id` + RLS. DDL essencial:

```sql
-- ── Tenancy & Auth ─────────────────────────────
create table tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text, uf text,
  plano text not null default 'starter',          -- starter|pro|enterprise
  criado_em timestamptz default now()
);

create table memberships (
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  papel text not null default 'analista',          -- owner|gestor|analista|leitor
  primary key (tenant_id, user_id)
);

-- ── Perfis monitorados ─────────────────────────
create table profiles_monitored (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  handle text not null,
  plataforma text not null default 'instagram',    -- instagram|x|facebook|tiktok|youtube
  categoria text,                                   -- governo|oposicao|imprensa|cidadao
  alvo boolean default false,                       -- é o político-alvo?
  criado_em timestamptz default now(),
  unique (tenant_id, plataforma, handle)
);

-- ── Posts ──────────────────────────────────────
create table posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  external_id text,                                 -- shortcode/id da plataforma
  url text, plataforma text, autor text, categoria text,
  data_post timestamptz, coletado_em timestamptz default now(),
  caption text,
  curtidas int default 0, comentarios_total int default 0,
  total_cidadaos int default 0, total_politicos int default 0,
  -- análise (IA)
  sentimento_post text, sentimento_comentarios text,
  comentarios_pct_pos numeric, comentarios_pct_neg numeric,
  score_imagem int, score_risco int, risco_crise text,
  tema text, atribuicao text, tendencia text,
  urgencia text, sugestao_acao text, janela_acao text,
  queixa_dominante text, elogio_dominante text,
  comentarios_destaque text, comentarios_destaque_curtidas int,
  comentarios_destaque_autor text, resumo text,
  padrao_detectado text,
  embedding vector(1536),                           -- pgvector p/ clustering
  unique (tenant_id, plataforma, external_id)
);
create index on posts (tenant_id, data_post desc);
create index on posts using ivfflat (embedding vector_cosine_ops);

-- ── Comentários (granular = fidelidade real de curtidas) ──
create table comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  external_id text, autor text, tipo text,          -- cidadao|politico
  texto text, curtidas int default 0, data_comment timestamptz,
  sentimento text,                                  -- pos|neg|neu (IA)
  unique (tenant_id, post_id, external_id)
);
create index on comments (tenant_id, post_id, curtidas desc);

-- ── Snapshots diários (séries temporais dos índices) ──
create table daily_metrics (
  tenant_id uuid not null references tenants(id) on delete cascade,
  dia date not null,
  iad numeric,          -- Índice Aprovação Digital
  ica numeric,          -- Índice Confiança da Amostra
  risco numeric,        -- score de risco político 0-100
  nivel_crise text,     -- baixo|moderado|alto|critico
  volume_posts int, volume_coments int,
  pct_pos numeric, pct_neg numeric, pct_neu numeric,
  primary key (tenant_id, dia)
);

-- ── Narrativas (clusters) ──────────────────────
create table narratives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rotulo text, tema text, sentimento text,
  origem_handle text,                               -- quem iniciou
  primeiro_visto timestamptz, ultimo_visto timestamptz,
  volume int, amplificacao numeric,                 -- alcance estimado
  status text default 'ativa'                        -- ativa|esfriando|encerrada
);
create table narrative_posts (
  narrative_id uuid references narratives(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  primary key (narrative_id, post_id)
);

-- ── Influenciadores ────────────────────────────
create table influencers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  handle text, plataforma text,
  alcance int, engajamento numeric,
  alinhamento text,                                 -- aliado|neutro|opositor
  classe text,                                      -- macro|micro|nano|formador
  influencia_score numeric,                         -- 0-100
  unique (tenant_id, plataforma, handle)
);

-- ── Alertas / Crises ───────────────────────────
create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tipo text,                                        -- crise|pico_negativo|narrativa|influenciador
  nivel text,                                       -- baixo|moderado|alto|critico
  titulo text, descricao text,
  post_id uuid references posts(id),
  status text default 'aberto',                     -- aberto|reconhecido|resolvido
  criado_em timestamptz default now(),
  reconhecido_por uuid, resolvido_em timestamptz
);

-- ── Recomendações do assistente IA ─────────────
create table ai_briefings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  dia date, diagnostico text, oportunidades jsonb,
  alertas jsonb, recomendacoes jsonb, gerado_em timestamptz default now()
);

-- ── RLS (exemplo) ──────────────────────────────
alter table posts enable row level security;
create policy tenant_isolation on posts
  using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
-- (repetir policy em todas as tabelas tenantizadas)
```

---

## 4. Módulos de Inteligência — fórmulas reais

### 3. Índice de Aprovação Digital (IAD) — 0 a 100
Sentimento dos **comentários cidadãos**, ponderado por curtidas (voz amplificada
pesa mais), suavizado por média móvel:

```
peso(c)      = 1 + log10(1 + curtidas_c)
S_pos        = Σ peso(c)  para c.sentimento = pos e c.tipo = cidadao
S_neg        = Σ peso(c)  para c.sentimento = neg e c.tipo = cidadao
S_neu        = Σ peso(c)  para c.sentimento = neu e c.tipo = cidadao
IAD_bruto    = 100 * (S_pos + 0.5*S_neu) / (S_pos + S_neg + S_neu)
IAD          = EMA_7(IAD_bruto)            # média móvel exponencial 7 dias
```

### 4. Índice de Confiança da Amostra (ICA) — 0 a 100
Quão confiável é o retrato (evita "Severíssimo" com 3 comentários):

```
f_volume     = min(1, log10(1 + n_coments) / log10(1 + N_ref))   # N_ref=500
f_fontes     = min(1, perfis_distintos / 8)                       # diversidade
f_recencia   = e^(-Δh / 48)                                       # Δh=horas desde último post
f_balanco    = 1 - |pct_pos - pct_neg|/100 * 0.3                  # penaliza viés de 1 fonte
ICA          = 100 * (0.45*f_volume + 0.25*f_fontes + 0.20*f_recencia + 0.10*f_balanco)
```
> Regra de UX: índices (IAD, risco) exibem **badge de confiança** (ICA). ICA<40 ⇒ "amostra insuficiente", não dispara crise.

### 2. Risco Político (0-100) e 5. Tendência
```
neg_velocity = (pct_neg_hoje - pct_neg_3d_atras)        # aceleração do negativo
risco = clamp(0,100,
        0.35*(100-IAD) +
        0.25*pct_posts_risco_alto +
        0.20*max(0, neg_velocity*4) +
        0.15*amplificacao_negativa_norm +
        0.05*(100-ICA))
tendencia = sign(slope(IAD, janela=7d))                 # subindo|estável|caindo
previsao_24h = IAD + slope*1  (regressão linear simples + IC via ICA)
```

### 10. Central de Crises — limiares
```
nivel = critico  se risco>=80 ou (pico_negativo & ICA>=60 & narrativa_coordenada)
        alto     se risco>=60
        moderado se risco>=40
        baixo    caso contrário
```

### 7. Classificação de Influenciadores
```
influencia = 0.4*alcance_norm + 0.4*engajamento_norm + 0.2*frequencia_norm
classe = macro(>100k) | micro(10-100k) | nano(<10k) | formador(jornalista/político)
alinhamento = moda(sentimento dos posts do handle sobre o alvo)  # aliado|neutro|opositor
```

### 8. Amplificação & Origem de Narrativas
- Embeddings (`text-embedding-3-small`) dos posts → **clustering** (HDBSCAN/cosine) → narrativa.
- **Origem** = post mais antigo do cluster. **Amplificação** = Σ alcance dos perfis que replicaram.
- Visual: **Sankey** (origem → amplificadores → alcance) + linha do tempo do cluster.

### 9. Assistente Estratégico (IA)
Edge Function diária monta contexto (índices + top narrativas + crises abertas) e
pede ao Claude um JSON estruturado:
```json
{ "diagnostico": "...",
  "oportunidades": [{ "titulo","acao","impacto","esforco" }],
  "alertas":       [{ "nivel","tema","janela" }],
  "recomendacoes_comunicacao": [{ "canal","mensagem","tom","timing" }] }
```
Renderizado em cards acionáveis (cada um vira tarefa/alerta).

---

## 5. Endpoints / API (Supabase)

| Método | Rota (REST/RPC) | Descrição |
|---|---|---|
| GET | `/rest/v1/daily_metrics?dia=gte.{d}` | Séries de IAD/ICA/risco |
| POST | `/rest/v1/rpc/compute_indices` | Recalcula índices do tenant/dia |
| GET | `/rest/v1/posts?order=score_risco.desc` | Feed priorizado |
| GET | `/rest/v1/rpc/top_comments` | Comentários +curtidos (pos/neg) |
| GET | `/rest/v1/narratives?status=eq.ativa` | Narrativas ativas (+ sankey) |
| GET | `/rest/v1/influencers?order=influencia_score.desc` | Ranking influenciadores |
| GET | `/rest/v1/alerts?status=eq.aberto` | Alertas abertos |
| PATCH | `/rest/v1/alerts?id=eq.{id}` | Reconhecer/resolver alerta |
| POST | `/functions/v1/ai-briefing` | Gera briefing estratégico (Claude) |
| POST | `/functions/v1/ingest-webhook` | Recebe push do worker AGORA |
| WS | `realtime: alerts, daily_metrics` | Push de crise em tempo real |

**Edge Functions (Deno/TS):** `compute_indices`, `cluster_narratives`,
`classify_influencers`, `ai-briefing`, `crisis-detector` (cron 5min).

---

## 6. Wireframes textuais

### Centro de Comando (home)
```
┌ Topbar: [Radar◉] Município ▾   [⌘K Buscar]      Período▾  🌗  🔔3  Avatar ┐
├ Sidebar ──┬──────────────────────────────────────────────────────────────┤
│ Comando   │ FAIXA DE STATUS:  Nível de Crise: [MODERADO]  IAD 58 ▲2  ICA 71│
│ Aprovação │ ┌IAD gauge┐ ┌Risco gauge┐ ┌Sparkline 30d┐ ┌Δ negativos 24h┐    │
│ Tendências│ │  58/100 │ │  44/100   │ │  ╱╲___╱      │ │ +6pp ⚠         │    │
│ Risco     │ └─────────┘ └───────────┘ └──────────────┘ └────────────────┘   │
│ Crises    │ ┌ NARRATIVAS ATIVAS (sankey) ───┐ ┌ ALERTAS ───────────────┐    │
│ Influencs │ │ origem→amplificação→alcance   │ │ 🔴 Pico negativo Saúde │    │
│ Narrativas│ └───────────────────────────────┘ │ 🟠 Narrativa coord.    │    │
│ Assistente│ ┌ ASSISTENTE: Diagnóstico + 3 recomendações de comunicação ┐    │
│ Ajustes   │ └──────────────────────────────────────────────────────────┘   │
└───────────┴──────────────────────────────────────────────────────────────┘
```
> Sem espaços vazios: faixa de status sempre preenche o topo; insights (texto do
> assistente) acima de métricas brutas; deltas (▲▼ pp) ao lado de todo número.

### Central de Crises
```
[BAIXO]  [MODERADO]  [ALTO]  [CRÍTICO]   ← seletor/estado atual destacado
Timeline de incidentes  |  Ações sugeridas  |  Responsáveis  |  Status (aberto/resolv.)
```

---

## 7. Backlog priorizado (MoSCoW + esforço)

| P | Item | Módulo | Esforço |
|---|---|---|---|
| M | Schema Postgres + RLS + migração do Sheets | Infra | M |
| M | AGORA grava em Postgres (dual-write) | Ingestão | S |
| M | Auth + multi-tenant + seletor de tenant | Infra | M |
| M | Centro de Comando + IAD/ICA + gauges | Core | M |
| M | Central de Crises + detector (cron) + Realtime | Crise | M |
| S | Análise temporal (ECharts timeline) | Tendências | S |
| S | Ranking de influenciadores | Influencers | M |
| S | Clustering de narrativas + Sankey | Narrativas | L |
| S | Assistente IA (briefing diário) | IA | M |
| C | Tema claro/escuro pro + design system | UX | S |
| C | Exportação PDF/CSV, compartilhamento | Plataforma | M |
| W | Multi-plataforma (X, TikTok, YouTube) | Ingestão | L |

---

## 8. Roadmap

### Quick Wins (7 dias)
- Provisionar Supabase, schema + RLS, gerar types.
- AGORA dual-write (Sheets + Postgres).
- App React (Vite + shadcn) com Auth e **Centro de Comando** lendo IAD/ICA.
- `compute_indices` (Edge Function) + snapshot diário.
- Tema escuro profissional + design tokens.

### Curto Prazo (30 dias)
- Central de Crises com Realtime + `crisis-detector` (cron 5min) + push.
- Análise temporal (séries IAD/risco/sentimento) em ECharts.
- Ranking de influenciadores (cálculo + tela).
- Migração total: front antigo (HTML) aposentado.

### Médio Prazo (90 dias)
- Narrativas: embeddings (pgvector) + clustering + Sankey de amplificação.
- Assistente Estratégico (briefing diário acionável → tarefas/alertas).
- Previsão de risco 24/72h + intervalo de confiança (ICA).
- Exportações, papéis (owner/gestor/analista/leitor), audit log.

### Longo Prazo (180 dias)
- Multi-plataforma (X/Twitter, TikTok, YouTube, Facebook, notícias).
- Benchmark vs. adversários; mapa geográfico (bairros) com heatmap.
- White-label para agências; API pública; alertas WhatsApp/Telegram/e-mail.
- Modelos próprios de sentimento PT-BR (fine-tune) p/ reduzir custo de IA.

---

## 9. Métricas de Negócio (Product / SaaS)

- **Ativação:** % de tenants que configuram ≥3 perfis e abrem o Centro de Comando em 48h.
- **Engajamento:** DAU/MAU, alertas reconhecidos/resolvidos, briefings lidos.
- **Valor entregue:** crises detectadas antes de viralizar (tempo até alerta), recomendações aplicadas.
- **Receita:** MRR, ARPA, churn mensal, NRR, CAC payback.
- **Saúde técnica:** custo de IA por tenant/mês, latência da ingestão, cobertura de coleta.

## 10. Monetização SaaS

| Plano | Preço/mês (sugestão) | Limites | Público |
|---|---|---|---|
| **Starter** | R$ 297 | 1 alvo, 10 perfis, 1 plataforma, 2 usuários, dados 30d | vereador/pré-candidato |
| **Pro** | R$ 897 | 3 alvos, 40 perfis, 3 plataformas, 8 usuários, narrativas + assistente, 180d | prefeito/deputado |
| **Enterprise** | R$ 2.500+ | ilimitado, multi-plataforma, white-label, API, suporte dedicado, SLA | campanhas/agências |
| Add-ons | — | crise WhatsApp 24/7, relatórios sob demanda, analista humano | upsell |

**Modelo:** assinatura mensal/anual (2 meses grátis no anual) + add-ons de consumo
(coletas extras, IA premium). **Go-to-market:** sazonal em ciclo eleitoral; trials de
14 dias com onboarding assistido; parceria com agências de comunicação política.

---

## 11. Riscos & Conformidade
- **LGPD:** dados públicos, mas reter mínimo necessário; DPA por tenant; direito de exclusão.
- **ToS das plataformas:** coleta via Apify pode violar ToS; avaliar APIs oficiais/parcerias.
- **Viés/ética da IA:** documentar metodologia dos índices; ICA evita conclusões de amostra fraca.
- **Custo de IA:** cache de análise, batch, modelos próprios no longo prazo.
- **Segurança:** RLS em tudo, service-role só no worker, segredos em vault, MFA p/ owners.
