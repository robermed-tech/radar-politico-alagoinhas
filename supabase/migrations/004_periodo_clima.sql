-- ============================================================
-- 004 — Clima por período (dia/semana/mês)
-- Aplicar via Supabase Dashboard > SQL Editor (ou supabase db push).
-- Pré-requisitos: ai_briefings.sql, migracao_boletins.sql, 002_rbac_admin.sql.
--
-- Resumo: ai_briefings e boletins ganham a dimensão `periodo`
-- (dia/semana/mes) — cada linha passa a representar UMA janela de análise,
-- em vez de sempre "o dia". Chave primária de ambas passa a incluir
-- `periodo`. Aditivo: linhas existentes recebem periodo='dia' via DEFAULT,
-- então continuam sendo lidas exatamente como antes por quem não migrar.
-- ============================================================

ALTER TABLE ai_briefings ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'dia'
  CHECK (periodo IN ('dia', 'semana', 'mes'));
ALTER TABLE ai_briefings DROP CONSTRAINT IF EXISTS ai_briefings_pkey;
ALTER TABLE ai_briefings ADD PRIMARY KEY (tenant, dia, periodo);

ALTER TABLE boletins ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'dia'
  CHECK (periodo IN ('dia', 'semana', 'mes'));
ALTER TABLE boletins DROP CONSTRAINT IF EXISTS boletins_pkey;
ALTER TABLE boletins ADD PRIMARY KEY (tenant, dia, periodo);

-- dashboard_public (002_rbac_admin.sql) precisa expor periodo — sem isso o
-- usuário comum não consegue filtrar por período (fica sempre pegando
-- qualquer linha do dia, inclusive de periodo diferente do pedido).
-- `periodo` vai no FINAL do SELECT: CREATE OR REPLACE VIEW só aceita ADICIONAR
-- colunas ao final da lista existente — inserir no meio faz o Postgres achar
-- que é RENAME de uma coluna já existente (ex.: gerado_em -> periodo) e falha.
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
  ) AS boletim,
  b.periodo
FROM boletins b
WHERE b.tenant = get_user_tenant(auth.uid());

GRANT SELECT ON dashboard_public TO authenticated;
