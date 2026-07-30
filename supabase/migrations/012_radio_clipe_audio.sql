-- Migration 012 — clipe de áudio da citação (Rádio Escuta)
--
-- Por que existe: a citação exibida no card é TRANSCRIÇÃO AUTOMÁTICA, e o
-- Whisper alucina sobre música (já saiu "Suzy Allison Dance The Two Step" de
-- uma letra em inglês). O instante `ts_inicio` sempre esteve na tela justamente
-- para permitir conferência — mas conferir exigia abrir o áudio na Apify, que
-- ninguém faz. Com o trecho no próprio card, conferir vira um clique.
--
-- Por que um CLIPE, e não o áudio inteiro: o key-value store da Apify guarda o
-- bloco cheio (28,6 MB para 30 min), **não aceita Range** (pedir 100 KB devolve
-- os 28,6 MB) e some em **3 dias** — a retenção de dados do plano. As pautas
-- ficam 90 dias. Um player apontando para lá estaria quebrado na maioria dos
-- cards, e um proxy baixaria o arquivo inteiro a cada seek. O recorte de ~24 s
-- pesa ~0,4 MB e vive no nosso storage, pelo tempo que a pauta viver.

alter table public.radio_topics
  add column if not exists audio_clip text;

comment on column public.radio_topics.audio_clip is
  'Caminho do clipe de áudio da citação no bucket radio-clipes (privado). '
  'NULL = clipe não gerado (bloco anterior à migration 012, áudio já expirado '
  'na Apify, ou falha no recorte). A tela distingue os dois casos.';

-- O bucket `radio-clipes` é PRIVADO e criado fora daqui (API de storage): o
-- clipe traz voz de cidadão identificável — quem liga para a rádio e se
-- identifica no ar nunca escolheu falar com o sistema. O acesso é sempre por
-- URL assinada de vida curta, gerada para quem já está logado como admin.
--
-- Leitura direta pelo cliente fica bloqueada: sem policy de SELECT em
-- storage.objects para este bucket, só a chave de serviço enxerga os arquivos.
-- Isso é o mesmo padrão admin-only do resto da seção (migration 011).

-- Policy de leitura do bucket: ADMIN e mais ninguém.
--
-- Sem ela, `createSignedUrl` do navegador falha e o botão "ouvir o trecho" não
-- abre nada — a assinatura exige que o chamador enxergue o objeto. Com ela,
-- continua valendo o mesmo recorte da migration 011: Rádio Escuta é admin-only
-- nos dois lados, e esconder o menu sem fechar o RLS seria cosmético.
drop policy if exists "radio_clipes_select_admin" on storage.objects;
create policy "radio_clipes_select_admin"
  on storage.objects for select
  using (bucket_id = 'radio-clipes' and public.is_admin());
