-- ════════════════════════════════════════════════════════════════
-- Fase 3d — Assistente Estratégico (IA). Rode no SQL Editor do Supabase.
-- Guarda o briefing diário gerado pelo AGORA (Claude).
-- ════════════════════════════════════════════════════════════════

create table if not exists ai_briefings (
  tenant         text not null default 'alagoinhas',
  dia            date not null,
  nivel_crise    text,
  risco          numeric,
  diagnostico    text,
  oportunidades  jsonb default '[]'::jsonb,
  alertas        jsonb default '[]'::jsonb,
  recomendacoes  jsonb default '[]'::jsonb,
  gerado_em      timestamptz default now(),
  primary key (tenant, dia)
);

alter table ai_briefings enable row level security;

drop policy if exists "leitura publica briefings" on ai_briefings;
create policy "leitura publica briefings" on ai_briefings
  for select to anon using (true);
-- Escrita só via service_role (o AGORA). anon não insere.
