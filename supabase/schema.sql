-- ════════════════════════════════════════════════════════════════
-- Avaz — Schema Supabase (Fase 2)
-- Rode isto no Supabase: SQL Editor → New query → Run.
-- Single-tenant (foco Alagoinhas). Coluna tenant deixa pronto p/ multi-tenant futuro.
-- Leitura pública (mesma postura do Apps Script atual). Escrita só via service_role.
-- ════════════════════════════════════════════════════════════════

-- ── POSTS (espelha a aba "Radar" do Sheets) ──────────────────────
create table if not exists posts (
  url                            text primary key,        -- dedupe natural (igual ao Sheets)
  tenant                         text not null default 'alagoinhas',
  data_post                      text,
  autor                          text,
  categoria                      text,
  curtidas                       int  default 0,
  comentarios_total              int  default 0,
  total_cidadaos                 int  default 0,
  total_politicos                int  default 0,
  sentimento_post                text,
  sentimento_comentarios         text,
  comentarios_pct_pos            numeric default 0,
  comentarios_pct_neg            numeric default 0,
  score_imagem                   int  default 50,
  score_risco                    int  default 0,
  risco_crise                    text,
  queixa_dominante               text,
  elogio_dominante               text,
  comentarios_destaque           text,
  comentarios_destaque_curtidas  int  default 0,
  comentarios_destaque_autor     text,
  resumo                         text,
  padrao_detectado               text,
  tema                           text,
  atribuicao                     text,
  tendencia                      text,
  urgencia                       text,
  sugestao_acao                  text,
  janela_acao                    text,
  caption                        text,
  atualizado_em                  timestamptz default now()
);
create index if not exists posts_data_idx on posts (tenant, data_post desc);
create index if not exists posts_score_idx on posts (tenant, score_risco desc);

-- ── COMMENTS (granular — fidelidade real de curtidas) ────────────
create table if not exists comments (
  id              text primary key,                        -- comentario_id da plataforma
  tenant          text not null default 'alagoinhas',
  url_post        text references posts(url) on delete cascade,
  autor_post      text,
  categoria_post  text,
  username        text,
  tipo            text,                                     -- cidadao | politico
  texto           text,
  curtidas        int default 0,
  sentimento      text,
  data_comentario text,
  atualizado_em   timestamptz default now()
);
create index if not exists comments_post_idx on comments (url_post, curtidas desc);

-- ── DAILY_METRICS (séries dos índices — preenchido pelo briefing) ─
create table if not exists daily_metrics (
  tenant        text not null default 'alagoinhas',
  dia           date not null,
  iad           numeric,
  ica           numeric,
  risco         numeric,
  nivel_crise   text,
  volume_posts  int,
  volume_coments int,
  pct_pos       numeric,
  pct_neg       numeric,
  pct_neu       numeric,
  primary key (tenant, dia)
);

-- ════════════════════════════════════════════════════════════════
-- RLS — leitura pública (anon), escrita só service_role
-- ════════════════════════════════════════════════════════════════
alter table posts          enable row level security;
alter table comments       enable row level security;
alter table daily_metrics  enable row level security;

-- Leitura pública (o app React usa a anon key). service_role ignora RLS.
drop policy if exists "leitura publica posts" on posts;
create policy "leitura publica posts" on posts for select to anon using (true);

drop policy if exists "leitura publica comments" on comments;
create policy "leitura publica comments" on comments for select to anon using (true);

drop policy if exists "leitura publica metrics" on daily_metrics;
create policy "leitura publica metrics" on daily_metrics for select to anon using (true);

-- (Sem policies de INSERT/UPDATE para anon => writes bloqueados p/ público.
--  O AGORA grava com a service_role key, que tem bypass total de RLS.)
