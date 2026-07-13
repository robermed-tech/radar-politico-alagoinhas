-- 003_subtema_alert.sql
-- Alerta por volume de subtema (a "sensação popular" do brief de 03/07):
-- quando o mesmo subtema aparece em N+ comentários de cidadãos em 24h, dispara,
-- independente do score de risco de cada post. Adiciona os dois parâmetros ao
-- notification_config de quem já existe (idempotente — não sobrescreve valores
-- que o admin já tenha ajustado).
--
-- Default: subtema_ativo=false (canal de WhatsApp novo, ligado sob demanda pela
-- aba Notificações da Configuração). O agora.py e o frontend já leem com esse
-- mesmo default quando a chave falta; esta migration só materializa no banco.

UPDATE tenant_settings
SET notification_config = notification_config
      || jsonb_build_object('subtema_limiar', 3, 'subtema_ativo', false)
WHERE NOT (notification_config ? 'subtema_limiar');
