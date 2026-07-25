-- ============================================================
-- 008 — Série de seguidores por perfil monitorado (25/07/2026)
--
-- Alimenta o ranking de seguidores da tela "Análise por Perfil": quem tem
-- mais e menos seguidores, o total de cada um e o saldo de ganhos/perdas
-- entre uma coleta e outra.
--
-- É uma SÉRIE (uma linha por coleta), não um registro único sobrescrito:
-- sem histórico não existe delta, e o pedido do cliente é justamente
-- acompanhar quem está ganhando e perdendo seguidor ao longo do tempo.
--
-- Limite do que dá para medir: o Instagram publica apenas o TOTAL de
-- seguidores de uma conta — nunca a lista de quem entrou ou saiu. Por isso
-- as colunas guardam contadores, e o painel fala em SALDO (líquido) da
-- janela, sem sugerir identificação de quem deixou de seguir.
--
-- Escrita: só o pipeline (service_role, que bypassa RLS). Leitura liberada
-- como nas demais tabelas de painel (influencers, daily_themes): são contas
-- públicas institucionais, de imprensa e de políticos — nenhum dado pessoal
-- de cidadão entra aqui.
-- ============================================================

CREATE TABLE IF NOT EXISTS profile_metrics (
  tenant       TEXT        NOT NULL DEFAULT 'alagoinhas',
  handle       TEXT        NOT NULL,
  categoria    TEXT,
  seguidores   BIGINT      NOT NULL,
  seguindo     BIGINT      DEFAULT 0,
  publicacoes  BIGINT      DEFAULT 0,
  fonte        TEXT        NOT NULL DEFAULT 'instagrapi',  -- instagrapi | apify
  coletado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant, handle, coletado_em)
);

-- O painel sempre lê "os pontos mais recentes deste tenant".
CREATE INDEX IF NOT EXISTS profile_metrics_recentes_idx
  ON profile_metrics (tenant, coletado_em DESC);
-- E a série de um perfil específico, para o gráfico de evolução.
CREATE INDEX IF NOT EXISTS profile_metrics_handle_idx
  ON profile_metrics (tenant, handle, coletado_em DESC);

ALTER TABLE profile_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leitura publica profile_metrics" ON profile_metrics;
CREATE POLICY "leitura publica profile_metrics" ON profile_metrics
  FOR SELECT TO anon, authenticated
  USING (TRUE);
