# Avaliação do Radar Político sob a ótica da assessoria de comunicação

**Data:** 05/08/26
**Avaliador:** assessoria de comunicação (uso do sistema para decisão e gestão de crise de imagem)
**Escopo:** o que o produto entrega hoje para quem precisa decidir, não o que ele promete na documentação

---

## 1. Sumário executivo

O Radar Político é, do ponto de vista metodológico, **melhor que a média do mercado nacional de clipping**. A forma como ele classifica sentimento (com regras explícitas contra atalhos que quase toda ferramenta comete) e a separação entre "o que o perfil disse" e "como o público reagiu" são coisas que plataformas grandes não fazem com esse cuidado.

E, apesar disso, **hoje eu não tomaria uma decisão de crise com base nele sem checar antes**. Três motivos, todos verificados na base de produção nesta data:

1. **O sistema está cego desde 03/08 à noite.** As quatro últimas coletas voltaram vazias porque o crédito da Apify estourou (101,1% do teto). Estamos há cerca de 2 dias sem dado novo.
2. **A ação principal do produto não funciona.** O botão "Alertar Secretário" aponta para telefones fictícios e, por um erro de roteamento, manda **todo** alerta para a Secretaria de Saúde, seja qual for o assunto.
3. **A acurácia nunca foi medida.** Toda a estrutura de medição existe e nunca foi executada com rótulo humano. Não sei a taxa de erro do classificador que sustenta o produto inteiro.

O primeiro é conjuntural. O segundo é um bug de meia hora. O terceiro é o que separa "ferramenta interessante" de "ferramenta em que o gabinete confia". Nenhum dos três é fatal, e os três são resolvíveis em pouco tempo.

**Veredito prático:** use hoje como **radar de tendência e pauta**, e trate os números como indicativos. Não use ainda como **termômetro de opinião pública** nem como **sistema de acionamento**.

---

## 2. Como avaliei

Não fui pela documentação. Li o código do pipeline e das telas e consultei a base de produção do Supabase em 05/08/26. Todos os números abaixo saíram da base real, não de estimativa.

---

## 3. Retrato da base hoje

| Indicador | Valor |
|---|---|
| Período coberto | 01/06/26 a 03/08/26 (55 dias com métrica) |
| Publicações analisadas | 330 |
| Comentários analisados | 3.572 |
| Fontes monitoradas | 14 perfis de Instagram (2 governo, 6 oposição, 6 imprensa) |
| Comentários por post | média 28,7 · **mediana 8** · máximo 472 |
| Posts com zero comentário | 60 de 330 |
| Publicações por dia | 4,8 em média |
| Planos de crise gerados | 70 (32 classificados como crise real) |
| Pautas de rádio | 4 (a Rádio Escuta está desligada) |
| Alertas enviados a secretário em 2 meses | **1** |

Distribuição de sentimento dos comentários: 1.783 neutros, 1.418 negativos, 371 positivos.

Vale registrar um ponto a favor: **a base captura quase 4 vezes mais crítica que elogio.** Um sistema contratado pela prefeitura que estivesse com o dedo na balança não produziria esse resultado. Isso é sinal de honestidade metodológica, e é raro.

---

## 4. Pontos fortes

### 4.1 O critério de sentimento é superior ao do mercado

A maior parte das ferramentas de monitoramento usa análise de sentimento genérica, que comete erros grosseiros em contexto político. Aqui há regras explícitas contra os quatro atalhos mais comuns:

- **Apoio a opositor não é crítica à gestão.** "Parabéns, vereador" é sentimento sobre aquela pessoa, não sobre a prefeitura. Quando essa regra foi corrigida, 400 comentários (38% de todos os negativos da base) saíram do vermelho. Uma ferramenta que erra isso entrega um painel permanentemente mais sombrio que a realidade, e o gabinete toma decisão defensiva sem motivo.
- **Risada não é prova de ironia.** Emoji de riso aparece tanto em deboche quanto em quem defende a gestão.
- **Cobrança sem reprovação é neutra.** Perguntar "quando sai a obra?" não é criticar.
- **Limiares simétricos.** Antes o empate escorria para o lado negativo. Isso é dedo na balança ao contrário, e foi corrigido.

Esse é o principal ativo intelectual do produto e deve ser argumento comercial explícito.

### 4.2 Separa o que o perfil disse do que o público respondeu

`tom_publicacao` mede a fala do perfil; `sentimento_post` mede a reação do público. São campos diferentes e discordam com frequência. Sem essa separação, um post elogioso da prefeitura que tomou uma enxurrada de críticas seria contado como elogio da prefeitura a si mesma. Praticamente nenhuma clipadora faz essa distinção.

A medição de 27/07 mostra que o classificador não deduz pelo lado: `@prefeituraalagoinhas` teve 0 críticas e 20 elogios, `@soulucianoalmeida` teve 11 críticas e 0 elogios, e quatro perfis de oposição saíram com 0 críticas porque só publicaram agenda. Se o modelo estivesse deduzindo por perfil, oposição sairia 100% crítica.

### 4.3 Existe controle de qualidade do modelo

Há um conjunto de comandos de teste que rodam contra a base real sem gastar coleta: `--teste-sentimento`, `--teste-triagem`, `--teste-tom`, `--teste-filtro`, `--teste-localidade`. Isso é engenharia de qualidade que clipadora tradicional não tem, e permite mexer no critério sem quebrar o histórico.

O uso de `temperature=0` na classificação também está correto: sem isso o mesmo comentário podia sair positivo numa rodada e neutro na seguinte.

### 4.4 O segundo estágio filtra falso alarme

Dos 70 planos de crise gerados, o próprio sistema classificou **38 como não sendo crise real** e a tela só exibe os 32 reais. Num exemplo da base, o plano registra com todas as letras: "score alto (72) decorre de perfil político, não de conteúdo ofensivo real" e recomenda **não responder**, porque engajar elevaria a visibilidade. Essa recomendação está certa e é exatamente o tipo de conselho que um assessor experiente daria.

### 4.5 A Rádio Escuta é o maior diferencial competitivo

Capturar rádio local, transcrever, identificar a pauta e **entregar o clipe de áudio exatamente da frase citada** é algo que o mercado cobra caro e entrega pior. Em cidade do interior a rádio ainda é o formador de opinião principal, e a decisão de não jogar a rádio dentro do índice de aprovação (meia hora de locutor não é opinião popular) está tecnicamente certa.

Na base há um caso que prova o valor: o locutor desmentindo boato de fechamento do Hospital Dantas Bião e acusando "representantes do povo" de propagar fake news. Isso é matéria-prima de posicionamento que não aparece em nenhuma rede social.

### 4.6 O painel avisa quando para

Existe um banner de saúde do pipeline visível a qualquer usuário, que acende quando a coleta vem vazia ou quando o radar passa de 15h sem rodar. É honesto e a maioria dos concorrentes não tem.

### 4.7 Proteção de dado pessoal levada a sério

Opinião política de cidadão identificado é dado sensível, e o controlador é órgão público. Há expurgo automático de texto e usuário após 180 dias (90 para rádio, porque a voz identifica a pessoa), hash de autor e retenção documentada. Numa eventual auditoria, isso é a diferença entre um problema e um elogio.

### 4.8 Custo

Cerca de US$ 29/mês de coleta. Contrato de clipping tradicional para prefeitura fica na casa de milhares de reais por mês.

---

## 5. Pontos fracos

### P0. Bloqueadores: o sistema não é confiável para acionamento hoje

#### 5.1 Cego há 2 dias, e o motivo é orçamentário, não técnico

As quatro últimas coletas registraram "vazio": 03/08 às 23h, e 04/08 às 13h, 18h e 23h. A causa é o teto da Apify em **101,1% (US$ 29,32 de US$ 29,00)**.

O banner avisa, e isso é bom. Mas ele trata "coleta vazia" como aviso laranja, e não escala para vermelho depois de várias vazias seguidas. Para assessoria, **a falha mais perigosa do sistema é parecer calmo porque parou de olhar.** Dois dias sem dado numa semana de crise é o suficiente para o gabinete ser pego de surpresa.

Agravante: o teto é baixo demais para a função. US$ 29/mês é orçamento de hobby para um sistema que a prefeitura usa para decidir.

#### 5.2 O "Alertar Secretário" manda para números inexistentes

Os contatos estão em `radar-app/src/config/secretarios.ts` com os valores `+557531000000` a `+557531000007`, sequenciais, com o comentário no próprio arquivo: "Edite os campos whatsapp e email com os dados reais". A tabela `secretaries` do banco tem os mesmos números fictícios, e ainda **duplicados** (16 registros para 8 secretarias).

Ou seja: a principal ação de gestão de crise do produto nunca poderia ter funcionado.

#### 5.3 Todo alerta é roteado para a Secretaria de Saúde

Bug confirmado. A tabela `crisis_plans` não tem coluna `tema`, então o campo chega sempre vazio na tela. A função de roteamento faz:

```
t.includes(n) || n.includes(t)
```

Com `t` vazio, `n.includes("")` é **sempre verdadeiro** em JavaScript, e a busca casa com o primeiro item da lista, que é Saúde. Um alerta sobre buraco na rua vai para o secretário de Saúde. Um alerta sobre merenda escolar vai para o secretário de Saúde.

Isso significa que corrigir só os telefones não resolve: o roteamento também precisa ser consertado.

#### 5.4 A ferramenta de ação não entrou na rotina

Um único envio registrado em dois meses, em 13/07, e mesmo esse gravou tema e mensagem nulos. Um sistema de gestão de crise que não é acionado é um sistema de observação de crise. Pode ser consequência dos itens acima, e é o indicador que eu acompanharia mais de perto depois da correção.

#### 5.5 Alertas & Ações mostra crise velha como se fosse atual — CORRIGIDO em 05/08

A tela tem filtro de 24h/7dias/30dias, mas o filtro só afeta o briefing. Os planos vêm sempre como os 20 de maior score, **sem recorte de data**. Como 39 dos 70 planos são de junho, é possível estar lendo "situações que precisam de atenção" de dois meses atrás sob um cabeçalho que diz "últimas 24 horas". Numa tela de crise, isso é grave: mistura o que já passou com o que está acontecendo.

> **Correção aplicada em 05/08.** O recorte passou a ser por `gerado_em`, feito no servidor (filtrar no cliente depois do `limit=20` esconderia crise recente de score menor). Efeito medido: 24h agora exibe 0 planos, 7 dias exibe 6 e 30 dias exibe 11, contra os 12 de antes com a mais velha de 10/06. Cada card ganhou a **idade do alerta** ("há 3h", "há 1 dia"), porque dentro da mesma janela a urgência é diferente, e a janela sem plano ganhou **estado vazio próprio**, já que antes a seção simplesmente sumia.

---

### P1. Metodológicos: o número engana quem lê rápido

#### 5.6 O "50%" da tela inicial quer dizer "não medimos nada" — CORRIGIDO em 05/08

Este é o problema conceitual mais sério do produto.

Metade das publicações (166 de 330) tem sentimento zerado nos dois lados. A fórmula do índice de aprovação trata ausência de medição como neutro, e neutro pesa 0,5. O resultado: **o índice converge para exatamente 50,0 quando não há sinal nenhum.** Isso aconteceu em 14 dos 55 dias (25%).

E a tela mostra esse 50 em corpo gigante, com a legenda "Aprovação da gestão nos comentários analisados no período".

O assessor lê "metade da cidade aprova". O correto seria "não houve conversa suficiente para medir". São afirmações completamente diferentes, e a segunda deveria impedir qualquer decisão baseada naquele número.

**Correção necessária:** quando a amostra não sustenta o cálculo, a tela precisa dizer "sem sinal suficiente" em vez de exibir um número.

> **Correção aplicada em 05/08.** Abaixo de 10 comentários classificados no período, as três telas que mostram o índice (Estação Meteorológica, Aprovação e Centro de Comando) passam a dizer "Sem sinal" e informam quantos comentários foram classificados. Na Aprovação o velocímetro também some, porque agulha ao centro lê como medição de equilíbrio. O piso é 10 e não 1 porque com N votos um único comentário move o índice em 100/N pontos: abaixo disso um comentário sozinho troca a faixa de clima exibida.
>
> Efeito medido na base: dos 14 dias que exibiam 50,0 exato, **12 passam a dizer "sem sinal"**. Os outros 2 tinham 23 e 87 comentários classificados e continuam exibindo 50%, porque ali o empate foi medido de verdade. A distinção entre "medido e deu empate" e "não medido" é justamente o ponto. Nas janelas de 7 e 30 dias nada muda: o limiar só apaga o número onde não havia número a dar.

#### 5.7 A amostra é pequena para o que a tela sugere

Mediana de 8 comentários por post. 60 posts sem nenhum comentário. Só 1.685 comentários (47%) têm voto válido, isto é, sentimento definido com confiança suficiente para entrar na conta.

Alagoinhas tem porte de cidade média. Um painel construído sobre 1.685 opiniões válidas em dois meses é um **indicador de tendência**, não um retrato da opinião pública. O sistema até sabe disso: existe um índice de confiança da amostra, que ficou abaixo de 50 em 19 dos 55 dias.

O problema é de apresentação: **o aviso de amostra frágil aparece na Aprovação e no Centro de Comando, mas não na Estação Meteorológica**, que é justamente a tela de entrada onde o número grande está. Quem só abre a landing nunca vê a ressalva.

#### 5.8 O Mapa da Cidade opera com 1,7% dos dados

Apenas 61 dos 3.572 comentários têm bairro identificado. O bairro mais citado do ranking tem **5 menções**. Mangalô lidera com 5, Riacho da Guia tem 4, Centro tem 3.

Um ranking de bairro construído sobre 5 comentários vira decisão de alocação de equipe e de agenda do prefeito. Isso é estatisticamente irresponsável e precisa de piso mínimo de amostra antes de exibir posição no rank.

Registro o crédito devido: o trabalho de desambiguação de bairro (o caso do CTA que virou quatro críticas ao bairro Centro) foi bem feito e conservador. O problema não é a qualidade da regra, é o volume que sobra depois dela.

#### 5.9 A acurácia nunca foi medida

Existe metodologia completa: amostra estratificada, planilha cega para o rotulador humano, intervalo de confiança de Wilson, kappa de Cohen. Está tudo pronto e **nunca foi executado**.

Isso significa que ninguém sabe se o classificador acerta 95% ou 70%. Todo o produto repousa nessa classificação. Para um contrato com órgão público, essa é a pergunta que mais cedo ou mais tarde alguém vai fazer, e hoje não há resposta.

É também a maior oportunidade barata: umas 300 classificações rotuladas à mão resolvem, e o resultado vira argumento de venda.

#### 5.10 O score de risco é ruidoso

63 posts com score maior ou igual a 60, e 38 dos 70 planos descartados como não sendo crise real. Mais da metade do que o primeiro estágio marca como risco alto é ruído, corrigido depois por uma segunda chamada de modelo.

Funciona, mas é caro e indica que o score bruto não deveria ser exibido como se fosse medida de gravidade.

#### 5.11 A taxonomia de temas está larga demais

"comunicacao" responde por 131 dos 330 posts (40%) e "outro" por boa parte dos comentários. Um tema que absorve 40% da base não orienta ninguém. Precisa ser quebrado em categorias acionáveis por pasta.

#### 5.12 A detecção de coordenação está morta

O campo `suspeito_coordenacao` é falso em **3.572 de 3.572** comentários. Em política municipal, ataque coordenado e disparo em massa são padrão, não exceção. Ou a detecção não está implementada de fato, ou o critério nunca dispara. De qualquer forma, hoje é campo decorativo.

---

### P2. Cobertura: os pontos cegos

#### 5.13 O sistema enxerga uma rede só

Monitora Instagram. Não monitora:

- **Facebook**, presente em 86% das prefeituras e onde está a base mais velha e mais politizada em cidade média
- **Portais de notícia e Google News**, hoje só vistos pelo Instagram dos veículos
- **YouTube**, com coletor pronto e inerte
- **TikTok** e **X**
- **Grupos de WhatsApp**, que é onde a crise municipal de fato circula
- **Câmara de Vereadores**, sessões e requerimentos
- **Diário Oficial**, TCM e Ministério Público

Para efeito de comparação: as plataformas nacionais de referência trabalham na casa de centenas de milhares de fontes. Não é razoável competir nisso, mas monitorar uma rede só é pouco até para o padrão municipal.

#### 5.14 A Rádio Escuta, que é o maior diferencial, está desligada

As 4 estações cadastradas estão com `active = false`. Dos 7 blocos captados, 2 falharam com erro de gravação porque a URL cadastrada é página de player e não stream. O total histórico é de 4 pautas.

O melhor recurso do produto está fora do ar por problema de cadastro.

---

### P3. Produto: falta o que o mercado de clipping entrega

#### 5.15 Não existe entregável, só painel

O produto do clipping tradicional **não é o dashboard, é o boletim**. Prefeito não abre painel. Secretário não abre painel. Eles leem o que chega no celular às 7h da manhã.

Existem 39 briefings gerados no banco e nenhum caminho para eles saírem em PDF ou WhatsApp. É a lacuna com maior retorno sobre esforço de todo o relatório.

#### 5.16 Faltam as métricas que o setor cobra

- **Share of Voice**: quanto da conversa é nossa, da oposição e da imprensa. É a métrica mais básica do mercado e aqui não existe.
- **Favorabilidade por veículo**: qual portal ou perfil pega mais pesado, e a evolução disso.
- **Valoração de mídia espontânea**: quanto custaria comprar o espaço conquistado. É o número que justifica orçamento de comunicação na hora da prestação de contas.

#### 5.17 Nada prova que o ciclo fechou

Não há registro de quem foi acionado, em quanto tempo respondeu, o que foi feito e se o tema estabilizou depois. O cálculo de estabilização existe no backend, mas a tela foi removida.

Sem isso, a assessoria não consegue provar o próprio trabalho, que é justamente o que garante a renovação do contrato.

---

## 6. Plano de ação

### Nas próximas 72 horas

| # | Ação | Por quê |
|---|---|---|
| 1 | Recompor o crédito da Apify e subir o teto | O sistema está cego há 2 dias |
| 2 | Cadastrar os telefones reais dos secretários e apagar as 8 linhas duplicadas | O acionamento nunca funcionou |
| 3 | Corrigir o roteamento por tema (gravar `tema` no plano e tratar tema vazio) | Todo alerta vai para Saúde |
| 4 | Escalar o banner para vermelho depois de 2 coletas vazias seguidas | Foram 4 sem escalar |
| 5 | Filtrar os planos de crise pelo período selecionado | Crise de junho aparece como atual |

### Nos próximos 30 dias

| # | Ação | Por quê |
|---|---|---|
| 6 | Trocar o "50%" por "sem sinal suficiente" quando a amostra não sustentar | É o erro de leitura mais perigoso do produto |
| 7 | Levar o aviso de amostra para a Estação Meteorológica | A tela de entrada é a única sem a ressalva |
| 8 | Piso mínimo de menções no Mapa da Cidade | Ranking com n=5 vira decisão de agenda |
| 9 | Rodar a medição de acurácia com rótulo humano | Único jeito de saber a taxa de erro |
| 10 | Reativar a Rádio Escuta e corrigir as URLs de stream | O maior diferencial está desligado |
| 11 | Boletim diário em PDF e WhatsApp às 6h30 | O entregável do clipping é o boletim |

### Nos próximos 90 dias

| # | Ação |
|---|---|
| 12 | Facebook e portais de notícia (as duas maiores lacunas de cobertura) |
| 13 | Share of Voice: nós, oposição e imprensa na mesma tela |
| 14 | Registro de ciclo fechado: acionamento, resposta, tempo e desfecho |
| 15 | Quebrar a taxonomia de temas e aposentar o "comunicacao" genérico |
| 16 | Ativar o YouTube, que já tem coletor pronto |

---

## 7. Ideias de novas implantações

Baseadas no que o mercado nacional de clipping entrega e no que é específico do setor público municipal.

### 7.1 Boletim das 6h30 no WhatsApp do gabinete
O produto que o cliente realmente consome. Uma página: clima do dia, os 3 assuntos que subiram, a citação mais dura da rádio com o áudio, e o que responder. Substitui o dashboard para 90% dos usuários.

### 7.2 Valoração de mídia espontânea municipal
Adaptar a centimetragem clássica para o contexto digital: alcance estimado por publicação vezes custo de mídia local. Entrega ao gabinete a frase "a comunicação gerou o equivalente a R$ X em mídia este mês", que é o argumento que sustenta orçamento.

### 7.3 Share of Voice político
Divisão da conversa entre gestão, oposição e imprensa, com evolução semanal. Responde à pergunta que o prefeito faz de verdade: "estamos ganhando ou perdendo a narrativa?"

### 7.4 Radar de desinformação
O caso do Hospital Dantas Bião já apareceu na rádio: boato de fechamento, desmentido pelo governador. Detectar afirmação factual falsa em circulação, marcar como boato e sugerir desmentido é serviço de altíssimo valor e ninguém no mercado municipal faz bem.

### 7.5 Detecção de amplificação coordenada
Reativar o campo morto: contas criadas há pouco, mesma frase em janela curta, rede de perfis que sempre comenta junto. Distinguir revolta orgânica de operação é decisão de resposta completamente diferente.

### 7.6 Monitor da Câmara de Vereadores
Requerimento, convocação de secretário e discurso em tribuna são a origem de boa parte da crise municipal, e chegam com dias de antecedência do que estoura na rede. É o alerta mais antecipado que existe, e é público.

### 7.7 Cruzamento com a ouvidoria municipal
Comparar o que o cidadão reclama espontaneamente na rede com o que protocola formalmente. Quando divergem, o dado é ouro: revela demanda que não chega ao canal oficial e mostra em que bairro a ouvidoria não é conhecida.

### 7.8 Banco de posicionamentos aprovados
Biblioteca de respostas já validadas pelo jurídico e pelo gabinete, ligada ao tema do alerta. Na hora da crise ninguém escreve bem, e o atraso de duas horas custa mais que o texto imperfeito.

### 7.9 Benchmark com cidades vizinhas
Rodar o mesmo pipeline em 3 ou 4 municípios da região. Permite dizer "nossa aprovação caiu, mas caiu em toda a região por causa da chuva" em vez de tratar movimento regional como fracasso local. Como o sistema já é multi-tenant, o custo marginal é baixo.

### 7.10 Relatório trimestral de prestação de contas
Consolidado com evolução dos índices, crises detectadas, tempo de resposta e resultado. É o documento que garante renovação de contrato, e o sistema já tem quase todos os dados para gerá-lo.

---

## 8. Conclusão

O Radar Político acerta na parte difícil e falha na parte fácil.

A parte difícil é medir sentimento político sem produzir viés, e nisso ele é melhor que ferramentas que custam vinte vezes mais. As regras contra dedução por lado, a separação entre fala do perfil e reação do público, e o controle de qualidade do modelo são trabalho sério e defensável tecnicamente.

A parte fácil é cadastrar telefone de secretário, manter crédito de coleta e não exibir "50%" quando não se mediu nada. É aí que ele está falhando, e é por isso que hoje ele observa crise sem ajudar a gerenciar crise.

A boa notícia é a assimetria de esforço: os cinco bloqueadores somam poucas horas de trabalho, e resolvidos eles transformam a percepção do produto de "painel bonito" para "ferramenta de gabinete". A medição de acurácia e o boletim diário, somados a isso, colocam o sistema num patamar em que ele pode ser vendido para prefeitura vizinha sem ressalva.

**Recomendação:** executar o bloco de 72 horas antes de qualquer nova funcionalidade. Nenhuma tela nova vale mais que um alerta que chega no telefone certo.

---

### Fontes de mercado consultadas

- [Knewin, Clipping e monitoramento de mídia](https://www.knewin.com/clipping/)
- [Knewin, 5 métricas para medir mídia espontânea](https://www.knewin.com/blog/5-metricas-para-medir-midia-espontanea/)
- [Cortex Intelligence, empresa de clipping e como avaliar](https://www.cortex-intelligence.com/blog/comunicacao/empresa-de-clipping)
- [Zeeng, clipping de rádio e TV](https://zeeng.com.br/)
- [Comunique-se, mensuração de resultados em clipping](https://comunique-se.com.br/blog/como-mensurar-resultados-em-clipping/)
- [CGI.br, TIC Governo Eletrônico, uso de redes sociais por prefeituras](https://www.cgi.br/noticia/releases/tic-governo-eletronico-2023-mostra-que-91-das-prefeituras-disponibilizam-ao-menos-um-servico-online-aos-cidadaos/)
- [AG Communicare, social listening na política em 2026](https://www.agcommunicare.com/social-listening-politica-ferramentas-usos-2026)
