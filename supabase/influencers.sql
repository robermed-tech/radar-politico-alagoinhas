-- ════════════════════════════════════════════════════════════════
-- Fase 3b — Influenciadores. Rode no SQL Editor do Supabase.
-- ════════════════════════════════════════════════════════════════

create table if not exists influencers (
  tenant            text not null default 'alagoinhas',
  handle            text not null,
  tipo              text not null,                    -- perfil_monitorado | cidadao
  categoria         text,                              -- Governo|Oposicao|Imprensa|Cidadao
  alcance           int     default 0,                 -- soma de curtidas
  engajamento       numeric default 0,                 -- comentarios/posts
  frequencia        int     default 0,                 -- nº de posts/comentarios
  influencia_score  numeric default 0,                 -- 0-100 (composto)
  classe            text,                              -- macro | micro | nano | formador
  alinhamento       text,                              -- aliado | neutro | opositor
  pct_positivo      numeric default 0,
  pct_negativo      numeric default 0,
  ultima_atividade  timestamptz,
  atualizado_em     timestamptz default now(),
  primary key (tenant, handle, tipo)
);
create index if not exists influencers_score_idx on influencers (tenant, influencia_score desc);

alter table influencers enable row level security;

drop policy if exists "leitura publica influencers" on influencers;
create policy "leitura publica influencers" on influencers
  for select to anon using (true);
