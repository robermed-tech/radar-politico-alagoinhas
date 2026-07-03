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

-- RLS: apenas o tenant dona do registro pode ler/escrever
alter table service_status enable row level security;

create policy "tenant lê seu próprio status"
  on service_status for select
  using (tenant = current_setting('app.tenant', true));

-- O pipeline grava via service_role (sem RLS), então não precisa de policy de insert/update.
-- Mas se quiser permitir também via anon com JWT:
-- create policy "service_role pode tudo" on service_status for all using (true);
