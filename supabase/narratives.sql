-- ════════════════════════════════════════════════════════════════
-- Fase 3c — Narrativas. Rode no SQL Editor do Supabase.
-- Agrupa posts por (tema + sentimento) e identifica origem/amplificação.
-- ════════════════════════════════════════════════════════════════

create table if not exists narratives (
  id              text primary key,                    -- hash(tenant + tema + sentimento)
  tenant          text not null default 'alagoinhas',
  tema            text,
  sentimento      text,                                -- positivo|negativo|neutro
  rotulo          text,                                -- "Saúde - crítica" etc.
  origem_handle   text,                                -- quem iniciou (post mais antigo)
  origem_url      text,
  primeiro_visto  timestamptz,
  ultimo_visto    timestamptz,
  volume_posts    int     default 0,
  volume_coments  int     default 0,
  amplificacao    int     default 0,                   -- soma de curtidas
  perfis_distintos int    default 0,
  queixa_top      text,                                -- queixa mais frequente
  elogio_top      text,
  comentario_top  text,                                -- comentário cidadão +curtido
  comentario_top_curtidas int default 0,
  status          text default 'ativa',                -- ativa|esfriando|encerrada
  atualizado_em   timestamptz default now()
);
create index if not exists narratives_score_idx on narratives (tenant, amplificacao desc);
create index if not exists narratives_status_idx on narratives (tenant, status, ultimo_visto desc);

alter table narratives enable row level security;

drop policy if exists "leitura publica narratives" on narratives;
create policy "leitura publica narratives" on narratives
  for select to anon using (true);
