-- ============================================================
-- Sprint 3 — Infra SaaS: tabelas, RLS e funções
-- Aplicar via Supabase Dashboard > SQL Editor
-- ============================================================

-- ── TABELA: tenants ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id   TEXT PRIMARY KEY,
  municipio   TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'BA',
  perfis_json JSONB DEFAULT '{}'::jsonb,
  apify_token TEXT,
  whatsapp_destinatarios TEXT[] DEFAULT '{}',
  ativo       BOOLEAN DEFAULT TRUE,
  plano       TEXT DEFAULT 'trial',  -- trial | mensal | anual
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant de Alagoinhas (produção atual)
INSERT INTO tenants (tenant_id, municipio, estado, ativo, plano)
VALUES ('alagoinhas', 'Alagoinhas', 'BA', TRUE, 'active')
ON CONFLICT (tenant_id) DO NOTHING;

-- ── TABELA: tenants_users ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants_users (
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tenant_id)
);

-- ── FUNÇÃO RPC: get_user_tenant ──────────────────────────────
-- Resolve o tenant_id do usuário autenticado (chamada do frontend)
CREATE OR REPLACE FUNCTION get_user_tenant(uid UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM tenants_users WHERE user_id = uid LIMIT 1;
$$;

-- ── TABELAS: alertas (Sprint 2) ──────────────────────────────
CREATE TABLE IF NOT EXISTS alerta_config (
  id          SERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id),
  tipo        TEXT NOT NULL,   -- 'iad' | 'neg_pct' | 'tema'
  limiar      INTEGER NOT NULL DEFAULT 40,
  ativo       BOOLEAN DEFAULT TRUE,
  canal_whats BOOLEAN DEFAULT TRUE,
  canal_email BOOLEAN DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, tipo)
);

CREATE TABLE IF NOT EXISTS alerta_historico (
  id        SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  valor     INTEGER,
  mensagem  TEXT,
  canal     TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS: Row Level Security ───────────────────────────────────
-- Habilita RLS em todas as tabelas de dados

ALTER TABLE posts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_themes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE crisis_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_briefings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE boletins             ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordination_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerta_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerta_historico     ENABLE ROW LEVEL SECURITY;

-- Policy padrão: usuário autenticado vê apenas dados do seu tenant
-- Obs: as tabelas atuais usam coluna 'tenant' (não 'tenant_id').
-- Manter consistência com o agora.py que já usa 'tenant'.

CREATE POLICY "tenant_isolation_posts" ON posts
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_comments" ON comments
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_daily_metrics" ON daily_metrics
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_daily_themes" ON daily_themes
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_crisis_plans" ON crisis_plans
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_ai_briefings" ON ai_briefings
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_boletins" ON boletins
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_influencers" ON influencers
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_narratives" ON narratives
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_coordination_groups" ON coordination_groups
  FOR ALL USING (tenant = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_alerta_config" ON alerta_config
  FOR ALL USING (tenant_id = get_user_tenant(auth.uid()));

CREATE POLICY "tenant_isolation_alerta_historico" ON alerta_historico
  FOR ALL USING (tenant_id = get_user_tenant(auth.uid()));

-- ── ACESSO DO SERVICE ROLE (pipeline) ────────────────────────
-- O agora.py usa SUPABASE_SERVICE_KEY, que bypassa RLS por padrão.
-- Nenhuma mudança necessária no pipeline.

-- ── MIGRAÇÃO DE DADOS: marcar Alagoinhas ─────────────────────
-- Se alguma tabela ainda tem linhas sem tenant, marcar como alagoinhas.
-- UPDATE posts SET tenant = 'alagoinhas' WHERE tenant IS NULL OR tenant = '';
-- (Descomentar e executar se necessário.)
