-- ============================================================
-- 007 — Relevância e Fontes editáveis por qualquer usuário (25/07/2026)
--
-- Decisão do cliente: as telas de "Relevância" (palavras-chave de busca) e
-- "Fontes" (perfis monitorados) saem da Configuração (admin-only) e vão para
-- a barra lateral, para que qualquer usuário do tenant possa cadastrar e
-- desativar termos e perfis sem depender do administrador.
--
-- Sem esta migration a mudança seria só cosmética: a tela apareceria para o
-- usuário comum, mas todo INSERT/UPDATE/DELETE cairia silenciosamente no RLS
-- (o PostgREST devolve 0 linhas afetadas, sem erro visível no front).
--
-- Escopo: SOMENTE relevance_keywords, monitored_sources e sources. As demais
-- tabelas de configuração (tenant_settings com pesos de score e limiares de
-- clima, secretaries, profiles) continuam admin-only — os limiares de clima
-- em particular ficam restritos de propósito, para que o cliente não consiga
-- maquiar os próprios números (decisão da reunião de 24/07).
-- ============================================================

-- relevance_keywords + monitored_sources: escrita liberada para qualquer
-- autenticado DO MESMO TENANT (o isolamento entre clientes continua valendo).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['relevance_keywords','monitored_sources']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_admin_write" ON %1$s;', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_user_write" ON %1$s;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_user_write" ON %1$s FOR ALL TO authenticated '
      'USING (tenant_id = get_user_tenant(auth.uid())) '
      'WITH CHECK (tenant_id = get_user_tenant(auth.uid()));',
      t);
  END LOOP;
END $$;

-- sources (subsistema de coleta multi-plataforma) é single-tenant por decisão
-- de produto: não tem coluna tenant_id, então a policy libera o autenticado.
DROP POLICY IF EXISTS "sources_admin_write" ON sources;
DROP POLICY IF EXISTS "sources_user_write" ON sources;
CREATE POLICY "sources_user_write" ON sources
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);
