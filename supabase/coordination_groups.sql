-- ════════════════════════════════════════════════════════════════
-- Fase 3g (v2) — Grupos coordenados (detecção GLOBAL).
-- Rode no SQL Editor do Supabase.
-- Cada linha = um grupo de comentários quase-idênticos de contas diferentes.
-- ════════════════════════════════════════════════════════════════

create table if not exists coordination_groups (
  id                   text primary key,                 -- hash dos ids do grupo
  tenant               text not null default 'alagoinhas',
  texto_representativo text,                              -- comentário +curtido do grupo
  n_comentarios        int default 0,
  usernames            jsonb default '[]'::jsonb,         -- contas envolvidas
  sentimento           text,                              -- positivo|negativo|neutro
  autor_posts          jsonb default '[]'::jsonb,         -- perfis onde ocorreu
  atualizado_em        timestamptz default now()
);
create index if not exists coord_groups_n_idx on coordination_groups (tenant, n_comentarios desc);

alter table coordination_groups enable row level security;

drop policy if exists "leitura publica coord_groups" on coordination_groups;
create policy "leitura publica coord_groups" on coordination_groups
  for select to anon using (true);
