-- ============================================================
-- 006 — Histórico de envios MANUAIS de alertas (reunião 24/07)
--
-- Decisão: o "Histórico de Alertas" do dashboard deixa de listar os disparos
-- automáticos do agente e passa a registrar os envios manuais feitos pelo
-- prefeito/secretário de comunicação no card "Alertar Secretário" — o quê,
-- para quem, por qual canal e quando ("eu enviei sim para você, aqui, às
-- 15h de domingo").
--
-- A tabela message_log (002) já registrava canal/destinatário; aqui ela
-- ganha o conteúdo do envio. O nome de quem enviou é desnormalizado na
-- própria linha porque usuários comuns não têm SELECT em profiles de
-- terceiros (RLS) — sem isso, a tela do histórico não conseguiria mostrar
-- "enviado por" para não-admins.
-- ============================================================

ALTER TABLE message_log ADD COLUMN IF NOT EXISTS tema         TEXT;
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS mensagem     TEXT;
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS sent_by_nome TEXT;
