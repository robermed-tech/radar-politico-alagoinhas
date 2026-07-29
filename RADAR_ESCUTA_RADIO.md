# Escuta do Rádio — desenho da funcionalidade

Spec da nova seção admin-only do Radar Político: coleta e transcrição de rádios
locais via Apify, análise das pautas e envio ao secretário.

Escrito antes da implementação, **calibrado contra a saída real** do ator
(run `hK5Z0gROLJnqagdZo`, dataset `YBcBZRsx5jWSqRLiw`, 29/07/2026) — não contra
o schema declarado. O CLAUDE.md registrava "Rádio escuta é V2, fora de escopo";
esta spec traz para o escopo atual e aquela linha será atualizada junto.

O objetivo da análise é o mesmo do resto do produto: **medir como está a imagem
da prefeitura, do prefeito e da gestão junto à população.** Tudo aqui serve a
isso, e o que não serve fica de fora explicitamente.

---

## 1. O ator e seu contrato real

`radarp_traffic/radio-transcriber` (na API REST: `radarp_traffic~radio-transcriber`,
id `FaFWOSNfVIGHDS3j1`). Grava o stream ao vivo e transcreve com Groq Whisper
large-v3. **Não precisamos de serviço de transcrição próprio.**

**Input:**

| campo | tipo | default | nota |
|---|---|---|---|
| `radios` | array de `{name, streamUrl}` | as 4 do código | passamos as rádios ativas do banco |
| `durationMinutes` | int | 60 | quanto grava de cada estação |
| `language` | string | `pt` | |
| `groqApiKey` | string | — | **required**, é secret |
| `concurrency` | int | 2 | máx. 4 |

**Output (um item por rádio):**

```
radio, streamUrl, recordedAt (ISO), durationMinutes, language,
audioStoreKey, transcriptStoreKey,
transcription (string | null), segments [{start, end, text}],
status (SUCCESS | RECORDING_FAILED | …), wordCount, fileSizeMB
```

---

## 2. O que o teste real revelou (e que muda o desenho)

Estes três achados vêm da leitura da transcrição de 5 minutos das 4 estações.
Sem eles, a implementação óbvia teria saído errada e caro.

### 2.1 A rádio é quase toda música e publicidade

Os 357 palavras da 93 FM Bahia contêm: letra de música, dedicatórias de ouvintes
("boa tarde para Diego aí na Rua da Usina"), e comercial de laboratório. **Zero
conteúdo político.** Uma hora de programa vai ter a mesma proporção.

Consequência: **não se manda a transcrição crua para o modelo.** Entra um portão
de relevância *antes* da chamada, reusando o critério que já existe
(`_motivo_relevancia` + as `relevance_keywords` do cliente + as âncoras do
tenant). Só as janelas de segmentos que citam a gestão sobem para análise. Isso
não é otimização de custo apenas: é o mesmo critério do resto do produto — "o
clima só pode ser formado por conteúdo que se relacione com as palavras
cadastradas".

A janela é montada por vizinhança: segmento que casa com keyword mais os
segmentos adjacentes dentro de ±60 s, para o modelo receber o contexto da fala e
não uma frase decepada.

### 2.2 Whisper alucina em cima de música

No trecho musical saiu "Suzy Allison Dance The Two Step" e traduções tortas de
letra em inglês. Ou seja: **a transcrição não é citação literal confiável.**

Consequência: toda citação exibida ou enviada a secretário vai acompanhada de
`mm:ss` e do `audioStoreKey`, para conferência no áudio. A tela diz que é
transcrição automática. Nunca apresentar trecho transcrito como se fosse a
palavra exata de alguém — é a mesma disciplina de "inventar bairro errado é pior
que deixar em branco", aplicada a citação.

### 2.3 Estação pode falhar sozinha

`Rádio Boa 94.1 FM` voltou `RECORDING_FAILED`, `wordCount 0`. As outras três
funcionaram.

Consequência: `status` é gravado por estação e a tela distingue **"não captada"**
de **"captada e sem assunto de interesse"**. São coisas diferentes, e confundir
as duas faria o painel afirmar silêncio onde houve falha técnica — o mesmo erro
do "run verde ≠ coletou" do runbook.

---

## 3. Cadastro — tela Fontes (reuso)

O cadastro de fontes é uma tela só (decisão de 25/07). Rádio entra como terceira
plataforma em `sources`:

- `platform = 'radio'`, `handle` = `streamUrl`, `label` = nome da estação.
- Coluna nova `config jsonb`: `{programa, dias, hora_inicio, duracao_min, peso}`.
- Nasce `active = false`. Sem fonte ativa, zero chamada à Apify.

Captura por **faixa horária de programa**, não stream 24 h: o custo de gravação
e transcrição escala por minuto de áudio, e 2.1 mostra que fora do programa
falado o material é música.

---

## 4. Coleta — `coletor_radio.py`

Espelha `coletor_youtube.py`: lê fontes ativas, uma chamada de ator por lote de
rádios, cada estação isolada, resumo em `collection_logs` (`platform='radio'`).

1. Lê rádios ativas do tenant; nenhuma ativa → retorna sem chamar a Apify.
2. Monta `radios` a partir do banco (nunca do default hardcoded do ator).
3. Roda o ator, aguarda, busca o dataset. Payload cru vai para `raw`.
4. Grava em `radio_transcripts`, UNIQUE `(tenant_id, source_id, inicio_ts)` →
   reexecução não duplica bloco.
5. `--radio-dry-run` mostra o que seria captado e as chaves cruas do primeiro
   item, sem gravar (o YouTube ensinou que nome de campo de ator muda entre
   versões).

## 5. Análise — `radio_analise.py`, chamado pelo `agora.py`

Uma chamada por **janela relevante** (não por bloco inteiro), devolvendo as
pautas daquele trecho. Cada pauta é uma linha em `radio_topics`:

| campo | o que é |
|---|---|
| `assunto`, `resumo` | título curto e 2 a 4 frases |
| `citacao`, `ts_inicio`, `ts_fim` | trecho e o `mm:ss` para conferir no áudio |
| `tema` | vocabulário `TEMAS_VALIDOS`, o mesmo dos posts — permite cruzar com Instagram |
| `localidade` | passa por `normalizar_localidade` (herda a regra do Centro/CTA) |
| `interesse_gestao` (bool), `motivo_interesse` | o "quais interessam ao prefeito e por que" |
| `tom_sobre_gestao` | `critico`/`favoravel`/`neutro`/`nao_classificado`, default `nao_classificado` |
| `voz` | `locutor`/`ouvinte`/`entrevistado`/`reportagem` |
| `pedido` | demanda concreta, igual `comments.pedido` |
| `score_risco`, `urgencia`, `confianca` | critério da triagem, com piso de confiança |

O prompt herda, textualmente, os critérios já pagos com bug documentado:

- **Portão antes de tudo:** "este trecho emite juízo sobre a gestão municipal?"
  Notícia boa sobre a cidade que não é obra da gestão é `neutro`.
- **Proibido deduzir tom pelo lado.** Locutor crítico da gestão não torna toda
  fala dele crítica; nem o contrário. O lado é contexto de leitura, nunca atalho.
- **Elogio a opositor não é crítica à gestão.**
- **Cobrança sem reprovação é neutro** — a demanda vai em `pedido`.
- **Limiares simétricos** nos dois lados.
- **Sem travessão** em texto gerado.
- Confiança abaixo do piso conta no total e em nenhum lado.

### Rádio não entra no IAD nem no clima

Meia hora de locutor atacando a gestão é **um** formador de opinião, não meia
hora de opinião popular. Somar isso ao IAD faz um único programa fabricar
tempestade — é a mesma armadilha do "perfil político não é população", já
resolvida nos comentários (onde perfil político deixou de herdar a média do
próprio post). Então:

- IAD e clima continuam medindo só comentário de cidadão.
- Rádio ganha indicador próprio de pressão da mídia.
- `peso` por audiência existe no cadastro, default 1, editável só por admin —
  sem dado de audiência, não se inventa peso.

## 6. Frontend — "Escuta do Rádio" (admin-only)

Item no sidebar filtrado por `isAdmin` (mesma regra de "Configuração"), página
em `<RequireAdmin>`, chunk lazy. Padrão de página do painel: H1
`text-[34px] font-extrabold`, subtítulo `text-base text-txt-2`, `PeriodoFilter`
(24h/7dias/30dias) na mesma linha com `items-center`.

1. **KPIs** — rádios monitoradas, horas transcritas, pautas de interesse da
   gestão, divisão crítico/favorável/neutro entre as pautas que julgam a gestão.
2. **Um card por estação** — último bloco captado, assuntos debatidos, e cada
   pauta com resumo, "por que interessa", citação com `mm:ss` e marcador de voz
   (ouvinte × locutor). Estação com `RECORDING_FAILED` aparece como não captada,
   com o horário da tentativa.
3. **Rádio × Instagram** — o que a rádio pauta e o povo ainda não comenta, e o
   contrário. É o dado mais acionável para a SECOM: pauta nasce no rádio e chega
   às redes depois.
4. **Box de envio ao secretário**, igual ao do dashboard. O modal do
   `AlertaCrise` é extraído para `EnvioSecretario` (contato, canal WhatsApp /
   e-mail, textarea, regenerar, copiar, `wa.me` / `mailto`, `logMessageSend`) e o
   `AlertaCrise` passa a consumi-lo com comportamento idêntico. Envio segue
   **manual**, cai em `message_log` e aparece no Histórico de Alertas sem
   migration nova. A mensagem leva estação, programa, horário, assunto, citação
   com `mm:ss` e o porquê do interesse.
5. **Estado vazio honesto** — "nenhuma rádio ativa", com caminho para Fontes.

## 7. Migration 011

- `sources.platform` passa a aceitar `'radio'`; coluna `config jsonb`.
- `radio_transcripts` e `radio_topics`, com RLS de **select admin-only** (a
  funcionalidade é só do admin; se a policy não acompanhar a UI a leitura falha
  ou vaza, como já aconteceu na 007).
- **Retenção:** transcrição de rádio contém nome de ouvinte que ligou e manda
  abraço, então é dado pessoal. Transcrição bruta e `segments` expiram em 90
  dias pelo mesmo `--expurgar-pii`; resumo, tema, tom e localidade ficam.

## 8. Harness

- `python agora.py --teste-radio [N]` — roda a análise em transcrições já
  gravadas, sem escrever nada. O que olhar: se toda pauta de uma estação sair
  `critico`, o modelo está lendo a estação em vez do conteúdo.
- `python coletor_radio.py --radio-dry-run` — coleta sem gravar.
- Depois, rotulagem humana pelo fluxo cego do `acuracia.py`. O critério de
  acurácia vale aqui igual: reclassificar com o mesmo modelo mede
  autoconsistência, não acerto.

---

## 9. Melhorias sugeridas

1. **Pauta coordenada** — mesmo assunto em 3+ estações no mesmo dia é sinal bem
   mais forte que menção isolada, e merece alerta próprio.
2. **Citação com `mm:ss` + áudio** — já viável de graça, os `segments` vêm com
   `start`/`end`. Vira a defesa contra 2.2.
3. **Cruzamento de localidade** — bairro que aparece no rádio e não aparece nos
   comentários: demanda que a rádio carrega e a rede não.
4. **Dedicatória de ouvinte como sinal de alcance geográfico** — as menções de
   bairro nas dedicatórias dizem onde a estação é ouvida. Dado de audiência de
   graça, que hoje falta para calibrar `peso`.
5. **Voz de ouvinte separada** — é o trecho que mais se aproxima de opinião
   popular. Fica destacada na tela, sem entrar no IAD por ora.

## 9b. O que a implementação mudou em relação a esta spec

Registrado porque a spec foi escrita antes de o código existir, e duas coisas
mudaram ao encostar no real:

1. **O portão ganhou dois estágios.** A regra de imprensa exige a âncora do
   município no mesmo texto da palavra genérica. Isso descarta fala legítima ao
   vivo ("a prefeitura não recolheu o lixo", sem repetir o nome da cidade). Hoje
   `candidato` localiza o segmento e `gate` decide sobre a janela de ~2 min. A
   regra é a mesma; o que mudou é o tamanho do texto onde a âncora é procurada.
2. **O cadastro de rádio saiu da tela Fontes.** A spec falava em reusar a tela,
   pelo princípio do cadastro unificado. Mas a Fontes é aberta a qualquer
   usuário do tenant, e a funcionalidade é admin-only: o cadastro foi para
   dentro da própria Escuta do Rádio, e a tela Fontes passou a filtrar
   `platform !== "radio"`. A tabela `sources` continua sendo a mesma.

Também apareceu um bug de configuração que valeu comentário no código: o
`agora.py` chama `load_dotenv()` depois dos imports, então constante de
credencial lida no import fica vazia em execução local, e a escrita no Supabase
retorna 0 sem erro nenhum. Os dois módulos de rádio leem env em tempo de
chamada por isso.

## 10. Pendências que dependem do Robério

1. **`GROQ_API_KEY`** — é `required` no input do ator. O ator não guarda a chave;
   quem chama precisa passá-la. Sem esse secret no ambiente e no GitHub Actions,
   a coleta não roda.
2. **URL duplicada no cadastro do ator** — `Digital FM 96.3` e
   `Rádio Ouro Negro 100.5 FM` apontam para o mesmo stream
   (`https://8058.brasilstream.com.br/stream`) e, no teste, transcreveram áudios
   diferentes do mesmo endereço. Uma das duas está com a URL errada, e do jeito
   que está uma pauta vai ser atribuída à estação errada. Precisa da URL correta
   antes de a atribuição por estação valer algo.
3. **`Rádio Boa 94.1 FM`** falhou a gravação. A URL é uma página do
   radios.com.br, não um stream direto — provavelmente precisa da URL do stream.
