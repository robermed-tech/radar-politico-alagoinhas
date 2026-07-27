# Radar Político Alagoinhas — instruções para Claude Code

Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão neste repositório. Ele existe para reduzir o número de idas e voltas com o Robério durante depuração.

## Contexto do projeto (resumo)

- Sistema de monitoramento político via Instagram para a SECOM de Alagoinhas/BA (prefeito Gustavo Carmo).
- Pipeline ativo: Apify (scraping) → `agora.py` (Python) → Claude Haiku API → Google Sheets (abas Radar/Perfis) + Supabase (dual-write) → dashboard HTML + Radar Comando (Vite/React).
- **`agora.py` é o agente ativo.** `radar_agente.py` está descontinuado — nunca editar esse arquivo.
- GitHub Actions: o workflow ativo é o **`agora.yml`** (3x/dia: 08h, 14h e 19h BRT; cron em UTC). `radar.yml` está desabilitado desde ~jun/2026 — não confundir os dois.
- Frontend admin: `radar-comando.surge.sh` e `radar-politico-alg.surge.sh` (mesmo bundle, publicados juntos pelo CI). Supabase: projeto `radar-politico` (ref `wtlhqyqxhuchzloodoyx`), tenant `alagoinhas`.
- `agora.py` já lê `tenant_settings` do Supabase a cada execução (keywords, fontes, `climate_thresholds`, `notification_config`). Pendência real de configuração: os `score_weights` afetam só os índices calculados no frontend, não o score por post do modelo.

## Decisões de produto vigentes (revisões de 24 e 25/07/2026)

Vieram das reuniões com o cliente (PRs #37, #40 e #41). Valem como estado atual — não desfazer sem pedido explícito.

### Comportamento

- **Alertas são só manuais.** O disparo automático de WhatsApp pelo agente está desligado por padrão (`agora.py::_auto_dispatch_ativo`; religa via `tenant_settings.notification_config.auto_dispatch_whatsapp = true`). A detecção e o laço IRT continuam rodando; o envio ao secretário é feito pelo card "Alertar Secretário" do dashboard e fica registrado em `message_log` (colunas `tema`/`mensagem`/`sent_by_nome`, migration 006), que alimenta a página "Histórico de Alertas".
- **Relevância e Fontes são páginas da barra lateral, abertas a qualquer usuário** (não voltar para dentro da Configuração). O cadastro de fontes é unificado numa tela só: Instagram → `monitored_sources` (pipeline atual); YouTube → `sources` (nasce pausada). Não recriar as abas "Fontes (coleta)" e "Notificações" — foram removidas de propósito.
- Quem pode escrever o quê (migration 007): `relevance_keywords`, `monitored_sources` e `sources` aceitam qualquer autenticado do tenant. **Continuam admin-only**: `tenant_settings` (pesos de score e limiares de clima), `secretaries` e `profiles` — os limiares de clima ficam restritos para o cliente não maquiar os próprios números. Ao mover qualquer tela de config para fora do admin, lembrar que **só mudar a UI não basta**: sem ajustar a policy, a escrita falha silenciosamente no RLS.
- A seção **Narrativas** foi removida da UI (sidebar + página). O backend continua gerando os dados; não reintroduzir a tela sem pedido.
- **Influenciadores** não é mais item de menu — o conteúdo vive dentro de "Análise por Perfil".
- **Ranking de seguidores** (25/07) vive dentro de "Análise por Perfil": quem tem mais e menos seguidores, o total de cada conta e o saldo de ganhos/perdas por janela (última coleta, 24h, 7 dias). Série em `profile_metrics` (migration 008), gravada por `agora.py::gravar_metricas_perfis` a cada run e também sob demanda com `python agora.py --seguidores` (grátis via Instagrapi; `--com-apify` libera o fallback pago). O painel se atualiza sozinho a cada minuto. **O Instagram publica só o TOTAL de seguidores, nunca quem entrou ou saiu** — a tela fala em *saldo líquido* de propósito; não prometer lista de quem deixou de seguir.
- Rádio escuta (IA transcrevendo programa de rádio) é V2 — fora de escopo por ora.

### Critério de relevância (não afrouxar)

- **A lista de `relevance_keywords` é do cliente. Nunca adicionar, remover ou "melhorar" as palavras cadastradas** — só o admin mexe nisso pela UI.
- **Todo perfil cadastrado passa pelo filtro, inclusive os de governo** (revisão de 25/07). Antes a conta oficial da gestão era isenta ("a fonte já é o critério"), e por isso post de agenda cultural, festa junina e afins entrava na base e formava clima sem nenhuma relação com as palavras da tela Relevância. Decisão do cliente: **o clima só pode ser formado por conteúdo que se relacione com as palavras cadastradas, nada além disso.**
- O filtro (`agora.py::_motivo_relevancia`) classifica as keywords cadastradas em **específicas** (contêm um token distintivo: `prefeito de alagoinhas`, `gustavo carmo`) e **genéricas** (só tokens que servem para qualquer município: `prefeito`, `prefeitura`, `gestao municipal`, `administracao`). Genérica só vale se o texto também citar uma **âncora do tenant** (`alagoinhas`/`gustavo`/`carmo`), derivada das próprias keywords específicas.
- A âncora é exigida **apenas da imprensa** (cobre a região e publica sobre outras cidades). Oposição são políticos locais — quando escrevem "a gestão" é a daqui; exigir âncora deles descarta crítica legítima. Governo também não precisa de âncora (a conta já é da gestão daqui), mas **precisa de alguma keyword cadastrada** no texto.
- **Os handles dos perfis políticos cadastrados na tela Fontes (governo + oposição) também valem como âncora** (`agora.py::_ancoras_de_perfis`). Veículo local não repete o nome da cidade, mas cita os políticos daqui: sem isso, matéria de cobrança à gestão que marcava `@gleysersoares` e `@jaldicenunes` era descartada como "notícia de outra cidade" (achado na limpeza de 25/07). **Handles de imprensa ficam de fora de propósito** — o nome do veículo não diz de que cidade é o fato narrado, e foi justamente por isso que a âncora passou a ser exigida da imprensa. Handles com menos de 6 caracteres são ignorados: o match é por substring e um handle curto casaria dentro de qualquer palavra.
- Efeito medido em 25/07 sobre a base real (231 posts, 9 keywords cadastradas): 116 passam e 115 são descartados; só 3 dos 29 posts de `@gustavoascarmo` sobrevivem, porque ele escreve em primeira pessoa e raramente usa as palavras da lista. **Se o cliente quiser recuperar esse volume, o caminho é cadastrar `alagoinhas` na tela Relevância** (mediu-se 188 passam / 43 fora nesse cenário) — a decisão é dele, tomada na UI dele; nunca adicionar a palavra por conta própria.
- O match é por **substring** de propósito: `@prefeituraalagoinhas` e `@gustavoascarmo` vêm colados na menção e são o sinal mais forte de que o post é local. Trocar por match de palavra inteira já quebrou isso uma vez.
- Antes de mexer nesse filtro, medir contra a base real com `python agora.py --teste-filtro` (mostra a classificação das keywords e o motivo de cada decisão). No Windows, rodar com `PYTHONIOENCODING=utf-8`.

### Critério de sentimento (revisão de 25/07 — não reintroduzir os atalhos)

O clima mede **o sentimento que o cidadão expressou sobre a gestão municipal**. Nunca deduzir polaridade por proxy: se a pessoa não avaliou a gestão, o dado certo é neutro. Cinco atalhos foram removidos por fabricarem sentimento que ninguém manifestou:

- **Apoio a opositor não é crítica à gestão.** "Parabéns vereador", "você é o próximo prefeito" = NEUTRO. Só vira negativo se o próprio comentário reprovar a gestão ou endossar a denúncia do post. A regra antiga marcava como negativo todo elogio a perfil opositor: 400 comentários (38% de todos os negativos) na base de 25/07. O lado do perfil (`OPOSITOR`/`ALIADO`) é **contexto de leitura, nunca atalho de polaridade** — vale para `PROMPT_COMENTARIOS`, `montar_prompt_comentarios::nota_lado` e `montar_prompt::lado`.
- **Risada não é prova de ironia.** 😂/kkkk aparece em deboche, mas também em concordância e no riso de quem defende a gestão. Ironia exige a contradição no texto. Risada dirigida a quem critica é defesa, não ataque.
- **Cobrança só é negativa quando há reprovação.** Pergunta ou recado sem reclamação é neutro; a demanda já é capturada no campo `pedido`.
- **Limiares simétricos.** Antes: 50% para negativo, 60% para positivo, e "misto" só descia para negativo (empate ia para o lado negativo). Isso é dedo na balança. Hoje os dois lados usam o mesmo limiar, em `agora.py` (safety net e `recalcular_sentimento_posts`) e em `data.ts` (`sentimentoReacao` e `fetchAgregadoComentarios`) — se mexer num, mexer nos quatro.
- **Sem inversão dupla por oposição.** `comentarios_pct_pos` já é medido como "favorável à gestão" na classificação de cada comentário; inverter de novo no agregado transformava aprovação em crítica.

**Os critérios valem para TODOS os prompts, não só o de comentários** (auditoria de 26/07). A revisão de 25/07 consertou `PROMPT_COMENTARIOS` e deixou `PROMPT_TRIAGEM` e `PROMPT_SISTEMA` para trás: os dois seguiram um mês mandando classificar apoio a opositor como crítica à gestão, e o `PROMPT_SISTEMA` chegava a se contradizer 150 linhas depois de si mesmo. Isso não é cosmético: a triagem produz `score_risco`, `urgencia` e `risco_crise` e decide se o post sobe para o Sonnet, e o `recalcular_sentimento_posts` **não corrige nenhum desses campos** (ele só reprojeta os percentuais). Ao mexer em critério de sentimento, varrer os quatro prompts: `PROMPT_TRIAGEM`, `PROMPT_SISTEMA`, `PROMPT_COMENTARIOS` e as notas de lado (`triar_post_rapido::nota_lado` e `montar_prompt_comentarios::nota_lado`).

Para medir mexidas na **triagem** existe `python agora.py --teste-triagem [N] [--imprensa|--governo]`: roda só o `PROMPT_TRIAGEM` numa amostra real (oposição por padrão, que é onde o atalho distorcia mais) e compara com o gravado, sem escrever nada. Custo: só Anthropic. Ele foi criado justamente porque a ausência de harness foi o que deixou a triagem escapar da revisão anterior.

Quem entra na conta do clima: **só comentário de cidadão** (perfil político não é população e não passa pelo classificador — antes herdava a média do próprio post, a média alimentando a si mesma) e **só com `confianca_tema >= 50`** (`CONFIANCA_MIN_SENTIMENTO` no agora.py, espelhado em `radar-app/src/lib/sentimento.ts`). Abaixo disso o comentário conta no total como indeterminado, nunca como crítica ou elogio.

Antes de mexer em qualquer critério de sentimento, medir com `python agora.py --teste-sentimento [N]`: reclassifica uma amostra real com os critérios atuais e compara com o gravado, **sem escrever nada**. Custo: só Anthropic, zero crédito Apify.

### Texto

- **Nunca usar travessão (—) em texto gerado ou exibido.** Os prompts do `agora.py` proíbem na origem; `limparTravessoes()` (radar-app/src/lib/format.ts) limpa textos antigos na exibição. Vale também para textos novos de UI.
- **Vocabulário**: "comentários analisados" (não "vozes ouvidas"); "estabilizar/estabilizado" (não "recuperar/recuperado"); "Sugestões genéricas a serem avaliadas por especialista" (nunca "o que deveria ter sido feito" — a plataforma sugere, não prescreve).
- **Sentence case, não Title Case**: usar a classe `.frase-cap` (index.css), nunca o `capitalize` do Tailwind — ele deixava "Instagram E Facebook Da Prefeitura", com preposição maiúscula no meio da frase.

### Índices e clima (auditoria de 26/07 — não reverter)

- **O risco político é normalizado pela soma dos pesos.** Antes os pesos somavam 0,65 no `agora.py` e o resultado era apresentado numa escala que diz ir de 0 a 100: o teto real era 65 e as faixas de `boletim.py` ("tempo fechando" ≥ 60, "tempestade" ≥ 80) eram inalcançáveis. Numa varredura das 9.261 combinações de (IAD, % risco alto, ICA), **69,7% caíam em "céu limpo" e "tempestade" tinha probabilidade zero** — o produto que vende alerta de crise não conseguia declarar uma. Depois da normalização: céu limpo 53,7%, tempestade 1,0%, e dia tranquilo continua céu limpo (não virou alarme falso). Se voltar a somar termo sem dividir pela soma dos pesos, o teto artificial volta junto.
- **`calc_risco()` (agora.py) e `calcRisco()` (indices.ts) são gêmeos**: mesmos termos, mesmos pesos, mesma normalização, incluindo a velocidade do negativo (pct_neg do dia menos o de 3 entradas atrás na série). Antes o backend usava 3 termos e o frontend 4, e o mesmo dia tinha dois riscos diferentes no mesmo produto. Mexeu num, mexe no outro.
- **`risco_amplificacao` fica fora do numerador E do denominador** enquanto o dado não for coletado. Ele era multiplicado por zero desde sempre; mantê-lo só no denominador recria o mesmo teto, agora disfarçado.
- **O clima tem uma fonte só: `getWeather(iad)`.** Havia um ramo `isAdmin` na ClimaPage em que o admin via o clima derivado do IAD (escala de aprovação, alto é bom) e o cliente via a condição do boletim (escala de risco, alto é ruim): duas grandezas na mesma metáfora visual, que podiam discordar no mesmo dia. `weatherFromCondicao` foi removida de propósito. O que ainda varia por papel é só o detalhe numérico (admin vê o valor do IAD, usuário comum vê o rótulo). Não reintroduzir uma segunda fonte de clima sem resolver a diferença de grandeza.

### Medição de acurácia (rótulo humano)

- Todo o valor do produto repousa na classificação de sentimento, e até 27/07 **ninguém tinha medido a taxa de erro**. `--teste-sentimento` compara o modelo atual com o anterior: isso mede **deriva** entre versões do critério, não acerto. Acurácia exige referência externa ao sistema medido.
- **Reclassificar a amostra com um modelo (o mesmo ou outro) não resolve.** Isso mede autoconsistência: o classificador vira o próprio gabarito e todo erro sistemático passa batido, porque ele erra igual nas duas vezes. O gabarito precisa ser humano.
- Fluxo em `acuracia.py` (módulo puro, com testes no `__main__`) mais duas flags:
  1. `python agora.py --amostra-rotulagem [N]` gera `rotulagem_<data>.html` (planilha **cega**, com atalhos 1/2/3/0 e progresso salvo no navegador) e `gabarito_<data>.json` (o que o modelo respondeu). Default 100 por estrato, 300 no total.
  2. Uma pessoa rotula e exporta `rotulos.csv`.
  3. `python agora.py --medir-acuracia rotulos.csv gabarito_<data>.json` reporta precisão com IC de Wilson, revocação, F1, matriz de confusão ponderada, acurácia geral e kappa de Cohen.
- **A amostra é estratificada pela classe PREVISTA**, não aleatória simples: a base é desbalanceada (negativo 47%, neutro 42%, positivo 11%) e 300 aleatórios trariam só ~32 positivos. Estratificar pela predição dá a precisão de cada classe direto do estrato, sem ponderação; para revocação, acurácia e kappa os estratos são reponderados por `N_h/n_h`.
- **No recorte "só confiantes" o universo também encolhe** (`N_conf`, não `N`). Usar o N cheio extrapolaria a subamostra confiante para uma população maior do que ela representa e inflaria justamente o número que o relatório apresenta como o mais importante. Há asserção cobrindo isso.
- **A planilha é cega de propósito**: rotulador que vê o palpite da máquina concorda com ela por ancoragem. O gabarito fica noutro arquivo. Há um teste que gera dois cartões idênticos no texto e diferentes só no rótulo do modelo e exige que sejam indistinguíveis.
- **Os arquivos gerados nunca vão para o repo nem viram artifact publicado** (já no `.gitignore`): contêm texto e @ de cidadãos reais, o mesmo dado que a retenção da migration 009 protege.
- O guia de rotulagem embutido no HTML espelha o critério do `PROMPT_COMENTARIOS`. Se o critério mudar, mudar o guia junto: senão a medição capta divergência de definição, não erro do modelo.

### Retenção de dados pessoais (LGPD)

- Opinião política de cidadão identificado é **dado pessoal sensível** (LGPD art. 5º, II) e o controlador é órgão público. O `autor_hash` era gravado na **mesma linha** que `username` e `texto` em claro, então a pseudonimização não separava identidade de conteúdo, e nada nunca era apagado.
- `agora.py::expurgar_pii` roda a cada pipeline e apaga `texto` e `username` dos comentários fora da janela (`RETENCAO_PII_DIAS`, default 180). **Preserva** sentimento, tema, subtema, localidade, pedido, curtidas, confiança e `autor_hash` — clima, índices, Pedidos, Bairros e a série histórica ficam inteiros. Migration **009**.
- Sob demanda: `python agora.py --expurgar-pii --dry-run` (conta sem escrever) ou `--expurgar-pii 180`. É idempotente via `pii_expurgado_em`. Cobre também linhas sem `data_comentario_dia` (falha de parse de fuso) pelo `atualizado_em`, senão elas ficariam fora da retenção para sempre.

### Visual

- **Tipografia**: o dashboard é lido em telão/TV, então o piso é maior que o default do Tailwind — `text-xs`=13px e `text-sm`=15px (override em `tailwind.config.ts`), `.section-label`=13px, labels de gráficos ECharts=12px. Ao criar tela nova, seguir esse piso; nunca reduzir para "caber".
- **Paleta**: sem identidade visual fechada, tudo que não tem cor semântica usa chumbo/grafite (`#334155` / `#1E293B`) com texto branco — nada de verde/vermelho decorativo. Verde e vermelho ficam reservados para sentimento (positivo/negativo).
- **Velocímetro por tema** (`components/GaugeTema.tsx`) — versão final: arco segmentado com escala **fixa e sempre visível, verde à esquerda (0%) em degradê até vermelho à direita (100%)**; o ponteiro aponta a **% de comentários NEGATIVOS** entre os que tomam partido (neutros fora da conta). Atenção: as rodadas anteriores oscilaram entre medir positivos e negativos — o que vale é negativos.
- **Estação Meteorológica** (landing): número do clima em destaque grande (90px, 126px no desktop); o card principal não leva chips de contagem; o box laranja de engajamento tem número + selo de qualidade da amostra + ação "Ver publicações"; a barra do radar de coleta fica no topo da página.
- **Previsões**: a linha do tempo não usa balões/pins (o tema do dia vive no tooltip); o status "Estabilizado" é **amarelo**, não verde.
- O modal de publicações mostra uma **introdução da legenda** de cada post (`posts.caption`, com fallback em `resumo`) para localizar a publicação sem abrir o Instagram.
- O feed **não** exibe a camada SCCT (cluster de crise, nível de responsabilização, resposta recomendada) nem o chip "Urgente" — o backend continua calculando, mas isso não vai para a leitura dos posts.

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
- Migrations aplicadas até **009** (006 = histórico de envios manuais em `message_log`; 007 = Relevância/Fontes editáveis por qualquer usuário; 008 = série de seguidores em `profile_metrics`; 009 = retenção de dados pessoais em `comments`, coluna `pii_expurgado_em` + índices do expurgo). Após DDL, o cache do PostgREST atualiza sozinho — validar com um insert/select de teste via REST, ou `select ... from pg_policies` quando a mudança for de RLS.

## Referências

- Pegadinhas de ambiente conhecidas: ver `GOTCHAS.md` neste mesmo diretório.
- Spec de arquitetura do admin: `2026-06-28-radar-comando-admin-rbac-design.md`.
