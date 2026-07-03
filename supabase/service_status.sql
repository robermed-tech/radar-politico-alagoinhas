-- Tabela de status de serviços externos (Apify, Evolution API, etc.)
-- Usada pelo pipeline (agora.py) para persistir métricas de saúde,
-- e pelo admin dashboard para exibir alertas de cota.

create table if not exists service_status (
  tenant       text    not null,
  servico      text    not null,
  uso_pct      numeric,          -- percentual consumido (0–100)
  uso_usd      numeric,          -- valor consumido em USD
  teto_usd     numeric,          -- limite mensal contratado em USD
  atualizado_em timestamptz,
  primary key (tenant, servico)
);

alter table service_status enable row level security;

-- Leitura pública (o app React usa a anon key e filtra por tenant na query,
-- igual às demais tabelas do dashboard — current_setting('app.tenant') não
-- funciona para chamadas anônimas do PostgREST, por isso a policy anterior
-- sempre retornava vazio).
drop policy if exists "tenant lê seu próprio status" on service_status;
drop policy if exists "leitura publica service_status" on service_status;
create policy "leitura publica service_status" on service_status
  for select to anon using (true);

-- O pipeline grava via service_role (sem RLS), então não precisa de policy de insert/update.
