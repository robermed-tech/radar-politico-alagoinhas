-- migracao_boletins.sql
-- Rodar no SQL Editor do Supabase (projeto do Radar Político)

CREATE TABLE IF NOT EXISTS boletins (
  tenant     text        NOT NULL,
  dia        date        NOT NULL,
  gerado_em  timestamptz NOT NULL DEFAULT now(),
  boletim    jsonb       NOT NULL,
  PRIMARY KEY (tenant, dia)
);

-- Leitura pública apenas via anon key se o seu frontend ler direto do Supabase.
-- Se o Radar Comando usa a anon key, habilite RLS com política de leitura:
ALTER TABLE boletins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leitura_boletins" ON boletins;
CREATE POLICY "leitura_boletins" ON boletins
  FOR SELECT USING (true);

-- A escrita acontece pelo agora.py com a SERVICE_KEY (bypassa RLS) — nada a fazer.

-- Consulta que o frontend usa (boletim mais recente):
-- SELECT boletim, gerado_em FROM boletins
--   WHERE tenant = 'alagoinhas' ORDER BY dia DESC LIMIT 1;
