-- ============================================================
-- 002 — RBAC + Página Admin (Radar Comando)
-- Aplicar via Supabase Dashboard > SQL Editor (ou supabase db push).
-- Pré-requisitos: 001_sprint3_saas.sql, migracao_boletins.sql aplicados.
--
-- Resumo:
--   • profiles (papel admin/user por tenant) + is_admin()
--   • tenant_settings, relevance_keywords, monitored_sources,
--     secretaries, message_log
--   • RLS: leitura para autenticado do tenant; escrita só admin
--   • view dashboard_public: boletim SEM o score numérico
--   • boletins: leitura completa restrita a admin (score protegido no banco)
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
-- Espelha auth.users e carrega papel + tenant. É a fonte da verdade
-- de papel/tenant; mantemos tenants_users em sincronia p/ compat.
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  tenant_id  TEXT NOT NULL DEFAULT 'alagoinhas' REFERENCES tenants(tenant_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS profiles_tenant_idx ON profiles (tenant_id);

-- is_admin(): o usuário logado é admin? (SECURITY DEFINER p/ ler profiles sob RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- get_user_tenant(): agora lê de profiles primeiro (fonte da verdade),
-- caindo para tenants_users (compat com policies do 001).
CREATE OR REPLACE FUNCTION get_user_tenant(uid UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM profiles WHERE id = uid),
    (SELECT tenant_id FROM tenants_users WHERE user_id = uid LIMIT 1)
  );
$$;

-- Criação automática de profile ao registrar usuário no Auth.
-- Lê role/tenant_id de user_metadata (preenchido pela Edge Function de convite).
-- search_path de funções SECURITY DEFINER não herda o da sessão/role — sem
-- qualificar o schema (ou fixar search_path), o INSERT falha com "relation
-- profiles does not exist" mesmo a tabela existindo em public.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'user'),
    COALESCE(NEW.raw_user_meta_data ->> 'tenant_id', 'alagoinhas')
  )
  ON CONFLICT (id) DO NOTHING;

  -- Mantém tenants_users em sincronia (compat com RLS do 001).
  INSERT INTO public.tenants_users (user_id, tenant_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'tenant_id', 'alagoinhas'))
  ON CONFLICT (user_id, tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── tenant_settings ──────────────────────────────────────────
-- Parâmetros configuráveis pelo Admin. O agora.py passará a ler daqui
-- (item de backend acoplado, fora desta leva).
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id          TEXT PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  score_weights      JSONB NOT NULL DEFAULT '{}'::jsonb,
  climate_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Alagoinhas com os valores HOJE em código (indices.ts / boletim.py /
-- SettingsPage). Fallback do pipeline = estes mesmos valores.
INSERT INTO tenant_settings (tenant_id, score_weights, climate_thresholds, notification_config)
VALUES (
  'alagoinhas',
  jsonb_build_object(
    'risco_iad',          0.35,
    'risco_pct_alto',     0.25,
    'risco_velocidade',   0.20,
    'risco_amplificacao', 0.15,
    'risco_ica',          0.05,
    'iad_neutro',         0.5
  ),
  jsonb_build_object(
    'faixas', jsonb_build_array(
      jsonb_build_array(0,  39.9,  'ceu_limpo',       NULL),
      jsonb_build_array(40, 59.9,  'nuvens_isoladas', 'amarelo'),
      jsonb_build_array(60, 79.9,  'tempo_fechando',  'laranja'),
      jsonb_build_array(80, 100,   'tempestade',      'vermelho')
    ),
    'limiar_previsao',              8.0,
    'limiar_tempestade_com_alerta', 60.0,
    'override_resp_min',            75
  ),
  jsonb_build_object(
    'iad_limiar', 40, 'iad_ativo', true,
    'neg_limiar', 60, 'neg_ativo', true,
    'tema_limiar', 50, 'tema_ativo', false,
    'canal_whats', true, 'canal_email', false
  )
)
ON CONFLICT (tenant_id) DO NOTHING;

-- ── relevance_keywords ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS relevance_keywords (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'alagoinhas' REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  keyword   TEXT NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, keyword)
);
CREATE INDEX IF NOT EXISTS relevance_keywords_tenant_idx ON relevance_keywords (tenant_id);

-- ── monitored_sources ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitored_sources (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'alagoinhas' REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  platform  TEXT NOT NULL DEFAULT 'instagram',
  handle    TEXT NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, platform, handle)
);
CREATE INDEX IF NOT EXISTS monitored_sources_tenant_idx ON monitored_sources (tenant_id);

-- ── secretaries ──────────────────────────────────────────────
-- Espelha config/secretarios.ts. O front continua usando os cards de
-- envio; estes dados passam a ser editáveis pelo Admin.
CREATE TABLE IF NOT EXISTS secretaries (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  TEXT NOT NULL DEFAULT 'alagoinhas' REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role_title TEXT,
  whatsapp   TEXT,
  email      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS secretaries_tenant_idx ON secretaries (tenant_id);

INSERT INTO secretaries (tenant_id, name, role_title, whatsapp, email)
VALUES
  ('alagoinhas', 'Secretaria Municipal de Saúde',              'Secretário(a) de Saúde',                  '+557531000001', 'saude@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Secretaria Municipal de Educação',           'Secretário(a) de Educação',               '+557531000002', 'educacao@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Secretaria Municipal de Obras',              'Secretário(a) de Obras e Infraestrutura', '+557531000003', 'obras@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Secretaria Municipal de Segurança',          'Secretário(a) de Segurança Pública',      '+557531000004', 'seguranca@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Secretaria Municipal de Transporte',         'Secretário(a) de Transporte',             '+557531000005', 'transporte@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Secretaria Municipal de Meio Ambiente',      'Secretário(a) de Meio Ambiente',          '+557531000006', 'meioambiente@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Secretaria Municipal de Assistência Social', 'Secretário(a) de Assistência Social',     '+557531000007', 'social@alagoinhas.ba.gov.br'),
  ('alagoinhas', 'Gabinete do Prefeito',                       'Chefe de Gabinete',                       '+557531000000', 'gabinete@alagoinhas.ba.gov.br')
ON CONFLICT DO NOTHING;

-- ── message_log ──────────────────────────────────────────────
-- Auditoria de disparos (cards de envio aos secretários).
CREATE TABLE IF NOT EXISTS message_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  TEXT NOT NULL DEFAULT 'alagoinhas' REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  sent_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel    TEXT NOT NULL,        -- 'whatsapp' | 'email'
  recipient  TEXT,
  status     TEXT NOT NULL DEFAULT 'aberto',  -- 'aberto' | 'erro'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS message_log_tenant_idx ON message_log (tenant_id, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE relevance_keywords  ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitored_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE secretaries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log         ENABLE ROW LEVEL SECURITY;

-- profiles: usuário lê o próprio; admin lê/edita todos do tenant.
DROP POLICY IF EXISTS "profiles_self_select" ON profiles;
CREATE POLICY "profiles_self_select" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR (is_admin() AND tenant_id = get_user_tenant(auth.uid())));

DROP POLICY IF EXISTS "profiles_admin_write" ON profiles;
CREATE POLICY "profiles_admin_write" ON profiles
  FOR ALL TO authenticated
  USING (is_admin() AND tenant_id = get_user_tenant(auth.uid()))
  WITH CHECK (is_admin() AND tenant_id = get_user_tenant(auth.uid()));

-- Helper macro p/ as tabelas de configuração:
--   SELECT: autenticado do mesmo tenant. INSERT/UPDATE/DELETE: só admin.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings','relevance_keywords','monitored_sources','secretaries']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select" ON %1$s;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select" ON %1$s FOR SELECT TO authenticated USING (tenant_id = get_user_tenant(auth.uid()));',
      t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_admin_write" ON %1$s;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_admin_write" ON %1$s FOR ALL TO authenticated USING (is_admin() AND tenant_id = get_user_tenant(auth.uid())) WITH CHECK (is_admin() AND tenant_id = get_user_tenant(auth.uid()));',
      t);
  END LOOP;
END $$;

-- message_log: autenticado insere o próprio e lê os do tenant; sem update/delete.
DROP POLICY IF EXISTS "message_log_insert" ON message_log;
CREATE POLICY "message_log_insert" ON message_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant(auth.uid()) AND sent_by = auth.uid());

DROP POLICY IF EXISTS "message_log_select" ON message_log;
CREATE POLICY "message_log_select" ON message_log
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant(auth.uid()));

-- ════════════════════════════════════════════════════════════
-- Esconder o score: boletins completo só p/ admin; view pública p/ todos
-- ════════════════════════════════════════════════════════════
-- Remove a leitura pública anterior (migracao_boletins.sql / 001).
DROP POLICY IF EXISTS "leitura_boletins" ON boletins;
DROP POLICY IF EXISTS "tenant_isolation_boletins" ON boletins;

-- Tabela completa (inclui pressao.valor, frentes[].score, termometro): só admin.
DROP POLICY IF EXISTS "boletins_admin_select" ON boletins;
CREATE POLICY "boletins_admin_select" ON boletins
  FOR SELECT TO authenticated
  USING (is_admin() AND tenant = get_user_tenant(auth.uid()));
-- (Escrita continua só via service_role do pipeline, que bypassa RLS.)

-- View pública: mesmo boletim, sem os campos numéricos de score.
-- É dona do role postgres (BYPASSRLS), então usuários comuns leem por aqui
-- mesmo sem acesso direto à tabela. Filtro de tenant explícito.
CREATE OR REPLACE VIEW dashboard_public AS
SELECT
  b.tenant,
  b.dia,
  b.gerado_em,
  jsonb_strip_nulls(
    (b.boletim - 'pressao' - 'termometro' - 'rajadas')
    || jsonb_build_object(
      'frentes',
        COALESCE(
          (SELECT jsonb_agg(f - 'score')
             FROM jsonb_array_elements(b.boletim -> 'frentes') AS f),
          '[]'::jsonb
        ),
      'alerta_ativo',
        CASE
          WHEN b.boletim -> 'alerta_ativo' IS NULL
            OR b.boletim -> 'alerta_ativo' = 'null'::jsonb
          THEN NULL
          ELSE (b.boletim -> 'alerta_ativo') #- '{scct,responsabilidade}'
        END
    )
  ) AS boletim
FROM boletins b
WHERE b.tenant = get_user_tenant(auth.uid());

GRANT SELECT ON dashboard_public TO authenticated;

-- ── Promover o primeiro admin ────────────────────────────────
-- Após criar/efetuar login do usuário gestor, rode UMA vez (troque o e-mail):
--   UPDATE profiles SET role = 'admin'
--     WHERE id = (SELECT id FROM auth.users WHERE email = 'gestor@prefeitura.ba.gov.br');
