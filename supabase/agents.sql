-- ════════════════════════════════════════════════════════════════
-- Fase B (multi-agente) — Auditoria de agentes + Planos de contenção.
-- Rode no SQL Editor do Supabase.
-- ════════════════════════════════════════════════════════════════

-- Auditoria: registro de cada execução de agente (transparência + custo)
create table if not exists agent_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant        text not null default 'alagoinhas',
  agente        text,                 -- cacador_crises | redator | ...
  modelo        text,
  gatilho       text,                 -- o que disparou
  input_ref     text,                 -- post.url ou 'dia'
  tokens_in     int default 0,
  tokens_out    int default 0,
  criado_em     timestamptz default now()
);
create index if not exists agent_runs_idx on agent_runs (tenant, criado_em desc);

-- Planos de contenção gerados pelo Caçador de Crises
create table if not exists crisis_plans (
  post_url        text primary key,
  tenant          text not null default 'alagoinhas',
  autor           text,
  e_crise_real    boolean default true,
  nivel           text,               -- baixo|moderado|alto|critico
  pavio           text,               -- o que disparou
  velocidade      text,               -- acelerando|estavel|esfriando
  janela_resposta text,               -- imediato|24h|esta semana
  plano_contencao jsonb default '[]'::jsonb,  -- lista de passos
  risco_se_ignorar text,
  score_risco     int default 0,
  gerado_em       timestamptz default now()
);
create index if not exists crisis_plans_idx on crisis_plans (tenant, gerado_em desc);

alter table agent_runs   enable row level security;
alter table crisis_plans enable row level security;

drop policy if exists "leitura publica agent_runs" on agent_runs;
create policy "leitura publica agent_runs" on agent_runs for select to anon using (true);

drop policy if exists "leitura publica crisis_plans" on crisis_plans;
create policy "leitura publica crisis_plans" on crisis_plans for select to anon using (true);
