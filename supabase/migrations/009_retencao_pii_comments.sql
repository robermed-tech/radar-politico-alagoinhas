-- ============================================================
-- 009 — Retenção de dados pessoais em `comments` (26/07/2026)
--
-- Achado da auditoria: o `autor_hash` era gravado na MESMA linha que o
-- `username` e o `texto` em claro. A pseudonimização não separava identidade
-- de conteúdo, ficava ao lado dela, e portanto não protegia nada. Somado a
-- isso, nada nunca era apagado: o banco acumulava indefinidamente opinião
-- política de cidadão identificado.
--
-- Opinião política é dado pessoal SENSÍVEL (LGPD art. 5º, II) e o controlador
-- aqui é órgão público (a Prefeitura). "Reter o mínimo necessário" não é boa
-- prática opcional nesse contexto, é obrigação legal, e o direito de eliminação
-- (art. 18, VI) precisa de um mecanismo, não de uma intenção.
--
-- Esta migration cria a infraestrutura; quem executa é `agora.py::expurgar_pii`,
-- que roda a cada pipeline e também sob demanda:
--     python agora.py --expurgar-pii --dry-run
--     python agora.py --expurgar-pii 180
--
-- O que o expurgo APAGA:     texto, username
-- O que ele PRESERVA:        sentimento, tema, subtema, localidade, pedido,
--                            curtidas, confianca_tema, autor_hash, datas
-- Ou seja: clima, índices, Pedidos do Povo, Mapa da Cidade e a série histórica
-- continuam inteiros. O que se perde é a capacidade de reler o comentário
-- original de um cidadão nomeado meses depois, que é exatamente o que não
-- deveria existir.
-- ============================================================

-- Marca de quando a linha teve os dados pessoais removidos. NULL = ainda não
-- expurgada. É também o filtro que torna o expurgo idempotente: rodar duas
-- vezes não reescreve o que já foi tratado.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS pii_expurgado_em TIMESTAMPTZ;

COMMENT ON COLUMN comments.pii_expurgado_em IS
  'Quando texto/username foram apagados pela política de retenção (LGPD). '
  'NULL = dentro da janela de retenção. Ver agora.py::expurgar_pii.';

COMMENT ON COLUMN comments.autor_hash IS
  'SHA-256 com salt do @ do autor. Depois do expurgo é o único identificador '
  'que resta na linha, e é o que sustenta contagem de autores distintos e '
  'detecção de coordenação sem expor a identidade.';

-- Índices do expurgo. Sem eles o PATCH varre a tabela inteira a cada execução
-- do pipeline (3x/dia).
CREATE INDEX IF NOT EXISTS comments_retencao_idx
  ON comments (tenant, data_comentario_dia)
  WHERE pii_expurgado_em IS NULL;

-- Linhas cujo dia não foi parseado (falha de fuso) caem no recorte de fallback
-- por atualizado_em; sem este índice esse segundo passe fica sequencial.
CREATE INDEX IF NOT EXISTS comments_retencao_fallback_idx
  ON comments (tenant, atualizado_em)
  WHERE pii_expurgado_em IS NULL AND data_comentario_dia IS NULL;
