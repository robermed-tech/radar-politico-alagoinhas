-- ══════════════════════════════════════════════════════════════════════════════
-- Avaz — Schema do Banco Central (Supabase / PostgreSQL)
-- Arquitetura: COLETORES → BANCO CENTRAL → CLAUDE → DASHBOARD
--
-- Execute este script no SQL Editor do Supabase:
--   https://app.supabase.com → seu projeto → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Extensão para UUIDs ────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ── Tabela: fontes ─────────────────────────────────────────────────────────────
-- Cada fonte é um perfil/canal monitorado (Instagram, YouTube, etc.)
-- Substituível: trocar Apify por PhantomBuster não muda esta tabela.
CREATE TABLE IF NOT EXISTS fontes (
    id           TEXT PRIMARY KEY,          -- ex: "instagram:gustavoascarmo"
    plataforma   TEXT NOT NULL,             -- "instagram" | "youtube" | "web"
    username     TEXT NOT NULL,
    categoria    TEXT NOT NULL,             -- "Prefeito" | "Oposição" | "Imprensa"
    cliente_id   TEXT NOT NULL,             -- ex: "alagoinhas"
    ativo        BOOLEAN DEFAULT TRUE,
    criado_em    TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE fontes IS 'Registro de todas as fontes monitoradas. Camada substituível — trocar coletor não impacta as outras tabelas.';


-- ── Tabela: posts ──────────────────────────────────────────────────────────────
-- Posts brutos coletados. Gravados ANTES da análise Claude.
-- Campo `analisado` controla o que ainda precisa ser processado.
CREATE TABLE IF NOT EXISTS posts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url              TEXT NOT NULL UNIQUE,    -- chave de deduplicação
    fonte_id         TEXT REFERENCES fontes(id) ON DELETE SET NULL,
    autor            TEXT,
    categoria_perfil TEXT,
    data_post        TEXT,                    -- formato "dd/mm/yyyy HH:MM"
    curtidas         INTEGER DEFAULT 0,
    comentarios_count INTEGER DEFAULT 0,
    caption          TEXT,
    analisado        BOOLEAN DEFAULT FALSE,   -- FALSE = aguardando Claude
    coletado_em      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_url       ON posts(url);
CREATE INDEX IF NOT EXISTS idx_posts_analisado ON posts(analisado);
CREATE INDEX IF NOT EXISTS idx_posts_fonte     ON posts(fonte_id);
CREATE INDEX IF NOT EXISTS idx_posts_coletado  ON posts(coletado_em DESC);

COMMENT ON TABLE posts IS 'Posts brutos do coletor. Claude só processa onde analisado = FALSE.';
COMMENT ON COLUMN posts.url IS 'Chave de deduplicação. Constraint UNIQUE impede coleta duplicada.';
COMMENT ON COLUMN posts.analisado IS 'Controlador de fila: FALSE = na fila para Claude, TRUE = já processado.';


-- ── Tabela: comentarios ────────────────────────────────────────────────────────
-- Comentários individuais coletados (para análises futuras mais granulares).
CREATE TABLE IF NOT EXISTS comentarios (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id      UUID REFERENCES posts(id) ON DELETE CASCADE,
    autor        TEXT,
    texto        TEXT,
    coletado_em  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comentarios_post ON comentarios(post_id);

COMMENT ON TABLE comentarios IS 'Comentários individuais por post. Enriquece análises futuras sem alterar o fluxo principal.';


-- ── Tabela: analises ──────────────────────────────────────────────────────────
-- Resultado da análise Claude. Um registro por post (1:1 com posts via post_id).
CREATE TABLE IF NOT EXISTS analises (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id                      UUID UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    sentimento_post              TEXT,
    sentimento_comentarios       TEXT,
    comentarios_negativos_pct    TEXT,
    comentarios_positivos_pct    TEXT,
    comentarios_positivos_texto  TEXT,
    comentarios_negativos_texto  TEXT,
    comentarios_destaque         TEXT,
    tema                         TEXT,
    tema_sensivel                TEXT,
    urgencia                     TEXT,
    risco_crise                  TEXT,
    tendencia                    TEXT,
    engajamento                  TEXT,
    resumo                       TEXT,
    atribuicao                   TEXT,
    sugestao_acao                TEXT,
    total_comentarios            INTEGER DEFAULT 0,
    comentaristas                TEXT,
    analisado_em                 TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analises_post      ON analises(post_id);
CREATE INDEX IF NOT EXISTS idx_analises_urgencia  ON analises(urgencia);
CREATE INDEX IF NOT EXISTS idx_analises_risco      ON analises(risco_crise);
CREATE INDEX IF NOT EXISTS idx_analises_tema      ON analises(tema);
CREATE INDEX IF NOT EXISTS idx_analises_timestamp ON analises(analisado_em DESC);

COMMENT ON TABLE analises IS 'Saída do Claude. Constraint UNIQUE em post_id garante 1 análise por post.';


-- ── View: dashboard ────────────────────────────────────────────────────────────
-- View desnormalizada para facilitar consultas do dashboard.
-- O dashboard pode ler diretamente esta view sem JOINs.
CREATE OR REPLACE VIEW vw_dashboard AS
SELECT
    p.id,
    p.url,
    p.autor,
    p.categoria_perfil,
    p.data_post,
    p.curtidas,
    p.comentarios_count,
    p.coletado_em,
    a.sentimento_post,
    a.sentimento_comentarios,
    a.comentarios_negativos_pct,
    a.comentarios_positivos_pct,
    a.comentarios_positivos_texto,
    a.comentarios_negativos_texto,
    a.comentarios_destaque,
    a.tema,
    a.tema_sensivel,
    a.urgencia,
    a.risco_crise,
    a.tendencia,
    a.engajamento,
    a.resumo,
    a.atribuicao,
    a.sugestao_acao,
    a.total_comentarios,
    a.comentaristas,
    a.analisado_em
FROM posts p
LEFT JOIN analises a ON a.post_id = p.id
WHERE p.analisado = TRUE
ORDER BY p.coletado_em DESC;

COMMENT ON VIEW vw_dashboard IS 'Vista unificada posts + análises para o dashboard. Sem JOINs necessários.';


-- ── Inserção inicial de fontes (Alagoinhas/BA) ─────────────────────────────────
INSERT INTO fontes (id, plataforma, username, categoria, cliente_id) VALUES
    ('instagram:gustavoascarmo',       'instagram', 'gustavoascarmo',       'Prefeito',   'alagoinhas'),
    ('instagram:prefeituraalagoinhas', 'instagram', 'prefeituraalagoinhas', 'Prefeitura', 'alagoinhas'),
    ('instagram:seligaalagoinhas',     'instagram', 'seligaalagoinhas',     'Imprensa',   'alagoinhas'),
    ('instagram:portalalagoinhasnews', 'instagram', 'portalalagoinhasnews', 'Imprensa',   'alagoinhas'),
    ('instagram:alagonews',            'instagram', 'alagonews',            'Imprensa',   'alagoinhas'),
    ('instagram:jornalalagoinhas',     'instagram', 'jornalalagoinhas',     'Imprensa',   'alagoinhas'),
    ('instagram:alagoinhas24h',        'instagram', 'alagoinhas24h',        'Imprensa',   'alagoinhas'),
    ('instagram:suacidade',            'instagram', 'suacidade',            'Imprensa',   'alagoinhas'),
    ('instagram:oficialjoaquimneto',   'instagram', 'oficialjoaquimneto',   'Oposição',   'alagoinhas'),
    ('instagram:soulucianoalmeida',    'instagram', 'soulucianoalmeida',    'Oposição',   'alagoinhas'),
    ('instagram:paulocezar_oficial',   'instagram', 'paulocezar_oficial',   'Oposição',   'alagoinhas'),
    ('instagram:jaldicenunes',         'instagram', 'jaldicenunes',         'Oposição',   'alagoinhas'),
    ('instagram:eulumamenezes',        'instagram', 'eulumamenezes',        'Oposição',   'alagoinhas'),
    ('instagram:gleysersoares',        'instagram', 'gleysersoares',        'Oposição',   'alagoinhas')
ON CONFLICT (id) DO NOTHING;
