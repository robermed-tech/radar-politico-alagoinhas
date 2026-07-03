-- ════════════════════════════════════════════════════════════════
-- Saúde do pipeline — 1 linha por tenant, sobrescrita a cada execução
-- do agora.py. Usada pelo App.tsx (fetchPipelineHealth) para o banner
-- de "dados desatualizados" quando o pipeline não roda há >8h.
-- ════════════════════════════════════════════════════════════════

create table if not exists pipeline_health (
  tenant             text not null default 'alagoinhas',
  executado_em       timestamptz not null,
  duracao_s          int     default 0,
  posts_coletados    int     default 0,
  posts_analisados   int     default 0,
  alertas_enviados   int     default 0,
  status             text    default 'ok',
  primary key (tenant)
);

alter table pipeline_health enable row level security;

drop policy if exists "leitura publica pipeline_health" on pipeline_health;
create policy "leitura publica pipeline_health" on pipeline_health
  for select to anon using (true);

-- Escrita só via service_role (o agora.py). anon não insere/atualiza.
