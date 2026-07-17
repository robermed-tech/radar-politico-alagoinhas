-- ============================================================
-- 005 — Coleta multi-plataforma: sources + collection_logs
-- Aplicar via Supabase Dashboard > SQL Editor (ou supabase db push).
-- Pré-requisitos: 002_rbac_admin.sql aplicado (is_admin()).
--
-- Estas tabelas JÁ existem no Supabase (foram criadas direto no console);
-- este arquivo apenas as versiona no repo. Tudo IF NOT EXISTS / idempotente,
-- então rodar de novo não quebra o que já está lá.
--
-- Resumo:
--   • sources          — fontes a monitorar (instagram/youtube), nascem pausadas
--   • collection_logs  — resumo de cada execução de coleta por fonte
--   • posts.platform   — distingue instagram (default) de youtube no dashboard
--   • posts.raw        — payload cru do coletor, p/ auditar o mapeamento Apify
--   • RLS: leitura p/ autenticado; escrita só admin. Pipeline usa service_role
--          (bypassa RLS).
--
-- NOTA de projeto: `sources` é o subsistema NOVO de coleta multi-plataforma.
-- Não substitui `monitored_sources` (que ainda alimenta o pipeline Instagram
-- atual) — as duas coexistem por ora. `sources` é single-tenant por decisão
-- de produto (sem tenant_id), diferente das tabelas de config do 002.
-- ============================================================

-- gen_random_uuid() vem de pgcrypto (já habilitado no Supabase por padrão).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── sources ──────────────────────────────────────────────────
-- Toda fonte nasce active=false: o sistema fica inerte até o admin ativar.
CREATE TABLE IF NOT EXISTS sources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform   TEXT NOT NULL,                       -- 'instagram' | 'youtube'
  handle     TEXT NOT NULL,                       -- normalizado pelo front antes de salvar
  label      TEXT,                                -- nome de exibição opcional
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, handle)
);
CREATE INDEX IF NOT EXISTS sources_active_idx ON sources (platform, active);

-- ── collection_logs ──────────────────────────────────────────
-- Um registro-resumo por (fonte, tipo de dado) a cada execução do coletor.
CREATE TABLE IF NOT EXISTS collection_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID REFERENCES sources(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  data_type    TEXT NOT NULL,                     -- 'videos' | 'comments' | ...
  items_count  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok',        -- 'ok' | 'erro' | 'vazio'
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS collection_logs_collected_idx ON collection_logs (collected_at DESC);
CREATE INDEX IF NOT EXISTS collection_logs_source_idx    ON collection_logs (source_id);

-- ── posts: colunas de coleta multi-plataforma ────────────────
-- platform distingue a origem no feed do dashboard (posts antigos = instagram).
-- raw guarda o payload cru do coletor p/ auditar o mapeamento campo-a-campo.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'instagram';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS raw JSONB;

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_logs ENABLE ROW LEVEL SECURITY;

-- sources: qualquer autenticado lê; só admin escreve.
DROP POLICY IF EXISTS "sources_select" ON sources;
CREATE POLICY "sources_select" ON sources
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "sources_admin_write" ON sources;
CREATE POLICY "sources_admin_write" ON sources
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- collection_logs: autenticado lê (monitor de coleta); escrita só admin pelo
-- front (na prática só o pipeline grava, via service_role que bypassa RLS).
DROP POLICY IF EXISTS "collection_logs_select" ON collection_logs;
CREATE POLICY "collection_logs_select" ON collection_logs
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "collection_logs_admin_write" ON collection_logs;
CREATE POLICY "collection_logs_admin_write" ON collection_logs
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
