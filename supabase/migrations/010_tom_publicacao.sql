-- ============================================================
-- 010 — Tom da publicação (27/07/2026)
--
-- ## Por que a coluna existe
--
-- O cliente pediu, na revisão de 27/07, saber "quem faz mais e quem faz menos
-- críticas positivas e negativas ao prefeito, prefeitura e sua gestão". A
-- primeira metade da pergunta ("quem TEM críticas") já era mensurável: são os
-- comentários dos cidadãos nas publicações do perfil. A segunda ("quem FAZ
-- críticas") não era, e não havia campo que servisse.
--
-- A tentação era usar `posts.sentimento_post`. Ele NÃO serve, e o próprio
-- prompt do agora.py diz o motivo em letras maiúsculas: sentimento_post é
-- "o IMPACTO na imagem do prefeito pela REAÇÃO dos comentários, NÃO o tom da
-- caption". Usá-lo como opinião do perfil transformaria a reação do público
-- na fala de quem publicou: um post elogioso da prefeitura que tomou uma
-- enxurrada de críticas nos comentários seria contabilizado como uma crítica
-- FEITA pela prefeitura contra ela mesma.
--
-- A outra tentação era deduzir pelo lado do perfil (oposição = crítica). Esse
-- é exatamente o atalho de polaridade por lado que a revisão de 25/07 removeu
-- de todos os prompts depois de descobrir que ele fabricava 400 críticas que
-- ninguém escreveu.
--
-- Daí a coluna nova: o tom é medido no TEXTO DA PUBLICAÇÃO, por classificação
-- explícita, e vive separado da reação que ela provocou.
--
--   sentimento_post  → o que o público respondeu       (reação, já existia)
--   tom_publicacao   → o que o perfil disse            (fala, esta migration)
--
-- Os dois discordam com frequência, e é justamente essa discordância que a
-- tela Análise por Perfil precisa mostrar.
--
-- ## Como preencher
--
-- O pipeline passa a gravar a cada execução. Para a base já existente:
--     python agora.py --teste-tom 20          (mede numa amostra, não escreve)
--     python agora.py --reclassificar-tom --dry-run
--     python agora.py --reclassificar-tom 500
-- Custo: só Anthropic (Haiku, uma chamada curta por post). Zero crédito Apify.
-- ============================================================

-- critico       = a publicação reprova, denuncia, cobra com reprovação ou
--                 ironiza a gestão municipal
-- favoravel     = a publicação elogia, defende ou promove realização da gestão
-- neutro        = informa sem julgar, ou não trata da gestão municipal
-- nao_classificado = ainda não passou pelo classificador (base anterior à
--                 migration, ou falha da chamada). É o default de propósito:
--                 "não medido" nunca pode virar "neutro" numa contagem, do
--                 mesmo jeito que confiança baixa em comentário não vira lado.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS tom_publicacao TEXT NOT NULL DEFAULT 'nao_classificado';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS confianca_tom INTEGER;

-- Barreira contra grafia livre: sem isto um "negativo" solto vindo de um
-- prompt futuro entraria calado e sumiria de toda contagem.
ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_tom_publicacao_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_tom_publicacao_check
  CHECK (tom_publicacao IN ('critico', 'favoravel', 'neutro', 'nao_classificado'));

COMMENT ON COLUMN posts.tom_publicacao IS
  'Tom da PUBLICAÇÃO em si sobre a gestão municipal: critico | favoravel | '
  'neutro | nao_classificado. Não confundir com sentimento_post, que mede a '
  'REAÇÃO dos comentários. Ver agora.py::CRITERIO_TOM_PUBLICACAO.';

COMMENT ON COLUMN posts.confianca_tom IS
  'Confiança 0-100 do classificador no tom. Abaixo de CONFIANCA_MIN_TOM '
  '(agora.py) a publicação conta no total mas não como crítica nem como '
  'elogio, mesma política de confianca_tema nos comentários.';

-- A Análise por Perfil agrupa por (tenant, autor) e conta o tom dentro de uma
-- janela de tempo. Sem índice isso vira varredura da tabela a cada troca de
-- 24h/7d/30d na tela.
CREATE INDEX IF NOT EXISTS posts_tom_por_perfil_idx
  ON posts (tenant, autor, data_post)
  WHERE tom_publicacao <> 'nao_classificado';

-- Fila do backfill: quais linhas ainda faltam classificar.
CREATE INDEX IF NOT EXISTS posts_tom_pendente_idx
  ON posts (tenant, data_post)
  WHERE tom_publicacao = 'nao_classificado';
