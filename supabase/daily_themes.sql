-- ════════════════════════════════════════════════════════════════
-- Fase 3e — Tendências por tema. Rode no SQL Editor do Supabase.
-- 1 linha por (tenant, dia, tema) — histórico real para análise temporal.
-- ════════════════════════════════════════════════════════════════

create table if not exists daily_themes (
  tenant         text not null default 'alagoinhas',
  dia            date not null,
  tema           text not null,
  volume_posts   int     default 0,
  volume_coments int     default 0,
  curtidas       int     default 0,
  pct_pos        numeric default 0,
  pct_neg        numeric default 0,
  pct_neu        numeric default 0,
  score_risco    numeric default 0,
  atualizado_em  timestamptz default now(),
  primary key (tenant, dia, tema)
);
create index if not exists daily_themes_tema_idx on daily_themes (tenant, tema, dia desc);

alter table daily_themes enable row level security;

drop policy if exists "leitura publica daily_themes" on daily_themes;
create policy "leitura publica daily_themes" on daily_themes
  for select to anon using (true);
