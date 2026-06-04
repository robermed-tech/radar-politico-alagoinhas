-- ════════════════════════════════════════════════════════════════
-- Fase 3g — Detecção de coordenação e bots.
-- Rode no SQL Editor do Supabase. Adiciona colunas em tabelas existentes.
-- ════════════════════════════════════════════════════════════════

-- Narrativas ganham score de coordenação + sinais detectados
alter table narratives
  add column if not exists coordenacao_score numeric default 0,        -- 0-100
  add column if not exists coordenacao_sinais jsonb default '[]'::jsonb, -- ["copia_cola", "burst_temporal", ...]
  add column if not exists suspeitos_usernames jsonb default '[]'::jsonb;

-- Comentários ganham flag de "suspeito de bot/coordenação"
alter table comments
  add column if not exists suspeito_coordenacao boolean default false,
  add column if not exists motivo_suspeita text;
