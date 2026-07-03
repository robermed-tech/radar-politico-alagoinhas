-- ════════════════════════════════════════════════════════════════
-- Camada SCCT por post + laço IRT (temas_monitorados)
-- Rode no SQL Editor do Supabase ANTES de mergear o agora.py que
-- envia estes campos — payload com coluna inexistente derruba o
-- upsert inteiro de posts (classe do incidente de 30/06).
-- ════════════════════════════════════════════════════════════════

-- 1. Colunas SCCT/Coombs em posts (já existem no Sheets; agora no dashboard)
alter table posts add column if not exists cluster_crise              text    default 'nenhum';
alter table posts add column if not exists responsabilidade_atribuida int     default 0;
alter table posts add column if not exists confianca                  int     default 0;
alter table posts add column if not exists abordagem_recomendada      text    default '';
alter table posts add column if not exists por_que_funciona           text    default '';
alter table posts add column if not exists motivo_alerta              text    default '';

-- 2. Laço IRT (Image Restoration Theory, Benoit): tema que disparou alerta
--    entra em monitoramento; runs seguintes medem a recuperação.
create table if not exists temas_monitorados (
  tenant        text not null default 'alagoinhas',
  tema          text not null,
  pico_em       date not null,
  origem        text    default '',            -- o que disparou o monitoramento
  volume_pico   int     default 0,             -- posts do tema na janela do pico
  pneg_pico     numeric default 0,             -- % de posts negativos no pico
  volume_atual  int     default 0,
  pneg_atual    numeric default 0,
  tendencia     text    default 'estavel',     -- em_queda | estavel | em_alta
  status        text    default 'monitorando', -- monitorando | recuperado | persistente
  atualizado_em timestamptz default now(),
  primary key (tenant, tema)
);

alter table temas_monitorados enable row level security;

drop policy if exists "leitura publica temas_monitorados" on temas_monitorados;
create policy "leitura publica temas_monitorados" on temas_monitorados
  for select to anon using (true);

-- Escrita só via service_role (agora.py). anon não insere/atualiza.
