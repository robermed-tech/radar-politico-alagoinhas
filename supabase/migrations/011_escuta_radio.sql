-- ============================================================
-- 011 — Escuta do Rádio (29/07/2026)
--
-- Coleta e transcrição de rádios locais via Apify
-- (radarp_traffic/radio-transcriber, que grava o stream e transcreve com Groq
-- Whisper large-v3), análise das pautas e envio ao secretário. Desenho completo
-- em RADAR_ESCUTA_RADIO.md.
--
-- ## Por que duas tabelas e não uma
--
-- `radio_transcripts` guarda o BLOCO captado (o que a estação disse durante N
-- minutos) e `radio_topics` guarda as PAUTAS extraídas dele. A separação não é
-- estética: uma hora de rádio contém muitos assuntos, e a granularidade do que
-- a tela mostra, do que vira alerta e do que cruza com o Instagram é o assunto,
-- não o bloco. Guardar só o bloco obrigaria a reanalisar para responder
-- qualquer pergunta; guardar só as pautas jogaria fora a evidência (o trecho
-- transcrito e o ponteiro para o áudio) que sustenta cada uma.
--
-- ## Por que a leitura é admin-only
--
-- A funcionalidade foi pedida como exclusiva do admin. Se a policy não
-- acompanhasse a UI a decisão seria só cosmética — foi o que a migration 007
-- registrou no sentido oposto (tela liberada e escrita ainda bloqueada pelo
-- RLS, falhando em silêncio). Aqui vale para os dois lados: sem is_admin(),
-- nem SELECT.
--
-- Isso alcança também as linhas de `sources` com platform='radio': a tela
-- Fontes é aberta a qualquer usuário e lista TODA fonte que não seja Instagram,
-- então sem estreitar a policy de select as rádios apareceriam lá.
--
-- ## Retenção
--
-- Transcrição de rádio contém nome de ouvinte que liga para mandar recado
-- ("boa tarde para Diego aí na Rua da Usina" apareceu no primeiro teste real).
-- É dado pessoal, e o controlador é órgão público. Transcrição bruta e
-- `segments` expiram em 90 dias pelo mesmo `--expurgar-pii` dos comentários;
-- resumo, tema, tom e localidade ficam, então a série histórica e os
-- indicadores continuam inteiros depois do expurgo. Mesma política da 009.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── sources: rádio como terceira plataforma ──────────────────
-- Reuso deliberado: a rádio herda o cadastro, o `active=false` de nascença e o
-- collection_logs que Instagram e YouTube já usam. O que é específico de rádio
-- (programa, faixa horária, peso de audiência) vai em `config`, para não abrir
-- coluna nova a cada plataforma.
--
--   config = {
--     "programa":     "Manhã de Notícias",
--     "dias":         ["seg","ter","qua","qui","sex"],
--     "hora_inicio":  "07:00",
--     "duracao_min":  60,
--     "peso":         1
--   }
--
-- `peso` nasce 1 para toda estação: sem dado de audiência, ponderar seria
-- inventar. Fica editável só pelo admin, igual aos pesos de score.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS config JSONB;

COMMENT ON COLUMN sources.config IS
  'Configuração específica da plataforma. Em platform=radio: programa, dias, '
  'hora_inicio, duracao_min e peso de audiência (default 1).';

-- ── radio_transcripts ────────────────────────────────────────
-- Um bloco captado de uma estação. Os nomes de campo espelham a saída real do
-- ator (run hK5Z0gROLJnqagdZo), não o schema declarado.
CREATE TABLE IF NOT EXISTS radio_transcripts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant               TEXT NOT NULL DEFAULT 'alagoinhas',
  source_id            UUID REFERENCES sources(id) ON DELETE SET NULL,
  estacao              TEXT NOT NULL,
  programa             TEXT,
  stream_url           TEXT,
  inicio_ts            TIMESTAMPTZ NOT NULL,        -- recordedAt do ator
  duracao_min          NUMERIC,
  -- status do ator: SUCCESS | RECORDING_FAILED | TRANSCRIPTION_FAILED | …
  -- Guardado porque estação falha sozinha (a Rádio Boa falhou no primeiro
  -- teste enquanto as outras três gravaram). A tela precisa distinguir "não
  -- captada" de "captada e sem assunto de interesse": tratar as duas como
  -- silêncio faria o painel afirmar que não houve pauta onde houve falha
  -- técnica, o mesmo engano do "run verde ≠ coletou".
  status               TEXT NOT NULL DEFAULT 'SUCCESS',
  palavras             INTEGER NOT NULL DEFAULT 0,  -- wordCount
  transcricao          TEXT,                        -- expira em 90 dias
  segments             JSONB,                       -- [{start,end,text}] — expira junto
  audio_store_key      TEXT,                        -- key no KV store do ator
  transcript_store_key TEXT,
  apify_run_id         TEXT,
  -- Quantas janelas do bloco passaram o portão de relevância. Zero com
  -- status=SUCCESS significa "a estação foi captada e não falou da gestão",
  -- que é resposta legítima e diferente de falha.
  janelas_relevantes   INTEGER NOT NULL DEFAULT 0,
  analisado_em         TIMESTAMPTZ,
  pii_expurgado_em     TIMESTAMPTZ,
  raw                  JSONB,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotência: o pipeline reexecuta e o mesmo bloco não pode duplicar.
  -- A chave é (tenant, estação, início) e não source_id porque a calibração
  -- roda sem fonte cadastrada.
  UNIQUE (tenant, estacao, inicio_ts)
);

CREATE INDEX IF NOT EXISTS radio_transcripts_periodo_idx
  ON radio_transcripts (tenant, inicio_ts DESC);
CREATE INDEX IF NOT EXISTS radio_transcripts_pendentes_idx
  ON radio_transcripts (tenant, inicio_ts)
  WHERE analisado_em IS NULL;
CREATE INDEX IF NOT EXISTS radio_transcripts_retencao_idx
  ON radio_transcripts (tenant, inicio_ts)
  WHERE pii_expurgado_em IS NULL;

-- ── radio_topics ─────────────────────────────────────────────
-- Uma pauta extraída de um bloco.
CREATE TABLE IF NOT EXISTS radio_topics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant           TEXT NOT NULL DEFAULT 'alagoinhas',
  transcript_id    UUID NOT NULL REFERENCES radio_transcripts(id) ON DELETE CASCADE,
  -- estacao/programa/captado_em são desnormalizados de propósito: a tela filtra
  -- por período e agrupa por estação em toda consulta, e o join extra não paga
  -- por si (mesma escolha que posts.autor já faz).
  estacao          TEXT NOT NULL,
  programa         TEXT,
  captado_em       TIMESTAMPTZ NOT NULL,
  assunto          TEXT NOT NULL,
  resumo           TEXT,
  -- Citação SEMPRE acompanhada do ponteiro para o áudio. Whisper alucina em
  -- cima de música (no primeiro teste saiu "Suzy Allison Dance The Two Step"
  -- de uma letra em inglês), então trecho transcrito não é a palavra exata de
  -- ninguém: é indício que se confere no áudio, e a UI diz isso.
  citacao          TEXT,
  ts_inicio        NUMERIC,
  ts_fim           NUMERIC,
  tema             TEXT,          -- vocabulário TEMAS_VALIDOS, o mesmo dos posts
  localidade       TEXT,          -- slug de bairro, via normalizar_localidade
  interesse_gestao BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_interesse TEXT,
  -- Mesmo vocabulário e mesmo default de posts.tom_publicacao (migration 010):
  -- "não medido" e "medido e deu neutro" continuam sendo coisas diferentes.
  tom_sobre_gestao TEXT NOT NULL DEFAULT 'nao_classificado'
    CHECK (tom_sobre_gestao IN ('critico','favoravel','neutro','nao_classificado')),
  -- Quem falou. Fala de ouvinte é o que mais se aproxima de opinião popular;
  -- locutor é formador de opinião. Misturar os dois faria um apresentador
  -- pesar como centenas de cidadãos — é a razão de a rádio ficar fora do IAD.
  voz              TEXT CHECK (voz IN ('locutor','ouvinte','entrevistado','reportagem') OR voz IS NULL),
  pedido           TEXT,
  score_risco      INTEGER NOT NULL DEFAULT 0,
  urgencia         TEXT,
  confianca        INTEGER NOT NULL DEFAULT 0,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transcript_id, ts_inicio, assunto)
);

CREATE INDEX IF NOT EXISTS radio_topics_periodo_idx
  ON radio_topics (tenant, captado_em DESC);
CREATE INDEX IF NOT EXISTS radio_topics_interesse_idx
  ON radio_topics (tenant, captado_em DESC)
  WHERE interesse_gestao;
CREATE INDEX IF NOT EXISTS radio_topics_tema_idx
  ON radio_topics (tenant, tema);

-- ════════════════════════════════════════════════════════════
-- RLS — admin-only nos dois sentidos (ver cabeçalho)
-- ════════════════════════════════════════════════════════════
ALTER TABLE radio_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE radio_topics      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['radio_transcripts','radio_topics']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_admin_select" ON %1$s;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_admin_select" ON %1$s FOR SELECT TO authenticated '
      'USING (is_admin());', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_admin_write" ON %1$s;', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_admin_write" ON %1$s FOR ALL TO authenticated '
      'USING (is_admin()) WITH CHECK (is_admin());', t);
  END LOOP;
END $$;

-- ── sources: estreita as policies para isolar as rádios ──────
-- A 007 abriu `sources` para qualquer autenticado (select e escrita), porque
-- Instagram e YouTube são cadastrados pelo cliente na tela Fontes. Rádio é
-- admin-only, e as duas coisas vivem na mesma tabela — então a policy passa a
-- olhar a plataforma. Sem isto, "somente no admin" não se sustentaria: a tela
-- Fontes lista toda fonte com platform <> 'instagram'.
DROP POLICY IF EXISTS "sources_select" ON sources;
CREATE POLICY "sources_select" ON sources
  FOR SELECT TO authenticated
  USING (platform <> 'radio' OR is_admin());

DROP POLICY IF EXISTS "sources_user_write" ON sources;
CREATE POLICY "sources_user_write" ON sources
  FOR ALL TO authenticated
  USING (platform <> 'radio')
  WITH CHECK (platform <> 'radio');

DROP POLICY IF EXISTS "sources_radio_admin_write" ON sources;
CREATE POLICY "sources_radio_admin_write" ON sources
  FOR ALL TO authenticated
  USING (platform = 'radio' AND is_admin())
  WITH CHECK (platform = 'radio' AND is_admin());
