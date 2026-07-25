# Radar Político Alagoinhas — instruções para Claude Code

Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão neste repositório. Ele existe para reduzir o número de idas e voltas com o Robério durante depuração.

## Contexto do projeto (resumo)

- Sistema de monitoramento político via Instagram para a SECOM de Alagoinhas/BA (prefeito Gustavo Carmo).
- Pipeline ativo: Apify (scraping) → `agora.py` (Python) → Claude Haiku API → Google Sheets (abas Radar/Perfis) + Supabase (dual-write) → dashboard HTML + Radar Comando (Vite/React).
- **`agora.py` é o agente ativo.** `radar_agente.py` está descontinuado — nunca editar esse arquivo.
- GitHub Actions: o workflow ativo é o **`agora.yml`** (3x/dia: 08h, 14h e 19h BRT; cron em UTC). `radar.yml` está desabilitado desde ~jun/2026 — não confundir os dois.
- Frontend admin: `radar-comando.surge.sh` e `radar-politico-alg.surge.sh` (mesmo bundle, publicados juntos pelo CI). Supabase: projeto `radar-politico` (ref `wtlhqyqxhuchzloodoyx`), tenant `alagoinhas`.
- `agora.py` já lê `tenant_settings` do Supabase a cada execução (keywords, fontes, `climate_thresholds`, `notification_config`). Pendência real de configuração: os `score_weights` afetam só os índices calculados no frontend, não o score por post do modelo.

## Decisões de produto vigentes (reunião de 24/07/2026)

- **Alertas são só manuais.** O disparo automático de WhatsApp pelo agente está desligado por padrão (`agora.py::_auto_dispatch_ativo`; religa via `tenant_settings.notification_config.auto_dispatch_whatsapp = true`). A detecção e o laço IRT continuam rodando; o envio ao secretário é feito pelo card "Alertar Secretário" do dashboard e fica registrado em `message_log` (colunas `tema`/`mensagem`/`sent_by_nome`, migration 006), que alimenta a página "Histórico de Alertas".
- **Nunca usar travessão (—) em texto gerado ou exibido.** Os prompts do `agora.py` proíbem na origem; `limparTravessoes()` (radar-app/src/lib/format.ts) limpa textos antigos na exibição. Vale também para textos novos de UI.
- **Vocabulário**: "comentários analisados" (não "vozes ouvidas"); "estabilizar/estabilizado" (não "recuperar/recuperado").
- **Paleta**: enquanto não há identidade visual fechada, tudo sem cor semântica definida usa chumbo/grafite com texto branco — nada de verde/vermelho decorativo.
- No admin, o cadastro de fontes é unificado na aba **Fontes** (Instagram → `monitored_sources`, pipeline atual; YouTube → `sources`, nasce pausada). Não recriar as abas "Fontes (coleta)" e "Notificações" — foram removidas de propósito.
- Rádio escuta (IA transcrevendo programa de rádio) é V2 — fora de escopo por ora.

## Protocolo de depuração autônoma

Ao investigar um bug, siga esta ordem sem esperar aprovação a cada passo:

1. **Formule uma hipótese antes de editar código.** Se a causa não está clara, adicione instrumentação (log) primeiro — não altere lógica "no escuro".
2. **Rode você mesmo.** Execute `python agora.py` (ou a flag relevante) e leia o output diretamente. Não peça para o Robério colar prints a menos que o comando dependa de algo que só ele tem acesso (ex: conta do Google, WhatsApp, aprovação visual do dashboard).
3. **Isole antes de tocar produção.** Use ou crie uma flag de teste (`--teste-filtro`, `--reprocessar` ou similar) em vez de rodar contra o pipeline de produção ou gastar créditos Apify desnecessariamente. Se não existir uma flag adequada para o teste que você precisa fazer, crie uma.
4. **Descarte hipóteses uma a uma.** Se o log esperado não aparecer, isso já é informação — não repita o mesmo teste, ajuste a hipótese (ex: o pipeline pode estar saindo antes mesmo de chegar na etapa que você está logando, como aconteceu com a deduplicação mascarando o bug do filtro de relevância).
5. **Depois de confirmar a causa raiz, limpe.** Remova logs de debug temporários ou coloque-os atrás de uma flag `--debug` — não deixe `print()` soltos no código de produção.
6. **Reporte de forma concisa**: o que quebrou, por que, o que foi mudado. Sem narrar todo o processo de tentativa e erro.

## Quando escalar para o Robério

Só pare e pergunte quando:
- A correção exige uma decisão de produto (ex: qual deve ser o comportamento correto, não só o bug técnico).
- Falta uma credencial, secret ou acesso que você não tem.
- O teste isolado já confirma o fix, mas rodar contra produção vai consumir créditos Apify de forma não trivial — aí sim, confirme antes de rodar contra produção real.

Fora isso, resolva e implemente diretamente, sem pausar para aprovação passo a passo.

## Migrations no Supabase

- SQL remoto (incluindo DDL) roda direto pelo CLI já logado nesta máquina, sem senha do banco:
  `supabase db query --linked --file supabase/migrations/00X_arquivo.sql`
  (projeto linkado com `supabase link --project-ref wtlhqyqxhuchzloodoyx --yes`; o link cria `supabase/.temp/`, que não deve ser commitado).
- Migrations aplicadas até 006 (histórico de envios manuais em `message_log`). Após DDL, o cache do PostgREST atualiza sozinho — validar com um insert/select de teste via REST.

## Referências

- Pegadinhas de ambiente conhecidas: ver `GOTCHAS.md` neste mesmo diretório.
- Spec de arquitetura do admin: `2026-06-28-radar-comando-admin-rbac-design.md`.
