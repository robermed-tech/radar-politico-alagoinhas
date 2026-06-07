# Como funcionam e como calibrar os alertas — Radar Político

Este guia explica **por que** um post vira alerta e **como ajustar** os gatilhos.
Serve de referência para você e para uma futura seção de ajuda no app.

---

## Por que um post dispara alerta

Cada post recebe um **score de risco de 0 a 100**, calculado de forma determinística
(em Python, não pelo modelo) a partir de seis fatores: risco da crise, urgência,
tendência, engajamento, tema sensível e palavras de crise no texto.

Um post vira alerta por **um de dois caminhos**:

1. **Pela régua de score** — quando o score atinge ou passa o limiar crítico
   (hoje **70**). É o caminho dos escândalos abertos e crises agudas.

2. **Pelo override SCCT** — quando o score fica *abaixo* de 70, mas o post é uma
   crise do tipo **intencional** (o público atribui a falha à gestão) com **alta
   responsabilidade** e que **já tem tração**. Esse caminho existe porque ataques
   de oposição bem construídos costumam parar em score ~62 (risco "Médio") e nunca
   cruzariam 70 — ficando invisíveis sem o override.

O sistema sempre registra **o motivo** do alerta (coluna `motivo_alerta` na planilha,
e linha "Por que alertou" no WhatsApp). Exemplos reais:

- `Score 100 ≥ 70 (risco Alto)`
- `Override SCCT — crise intencional, responsabilidade 75/100, tendência em alta (score 62)`

Assim, quem vê o alerta no app entende a razão sem precisar deduzir dos números.

---

## Os parâmetros que você ajusta

Todos ficam juntos, no topo do `radar_agente.py`, logo abaixo de `SCORE_ALERTA_CRITICO`.

| Parâmetro | Padrão | O que faz |
|---|---|---|
| `SCORE_ALERTA_CRITICO` | `70` | Score a partir do qual qualquer post alerta, independente de tudo. |
| `OVERRIDE_ALERTA_ATIVO` | `True` | Liga/desliga o override SCCT inteiro. `False` volta ao comportamento antigo (só score). |
| `OVERRIDE_RESPONSABILIDADE_MIN` | `70` | Responsabilidade atribuída mínima para o override considerar o caso. |
| `OVERRIDE_SCORE_MIN` | `55` | Piso de score do override. Abaixo disso o caso é considerado fraco e ignorado. |
| `OVERRIDE_EXIGE_TRACAO` | `True` | Exige que o post já esteja "Crescendo" OU com engajamento "Alto". Evita alertar caso parado. |

---

## Como calibrar, e por quê

A calibração é um equilíbrio entre **perder crise** (alerta de menos) e **fadiga de
alarme** (alerta demais, até a equipe parar de confiar no aviso). Ajuste **um
parâmetro por vez** e observe alguns dias antes do próximo ajuste.

**Se estiver chegando alerta demais** (ruído, coisa pequena avisando):

- Suba `OVERRIDE_SCORE_MIN` de 55 para 58–60. É o ajuste mais eficaz: corta os
  casos de menor intensidade primeiro.
- Ou suba `OVERRIDE_RESPONSABILIDADE_MIN` de 70 para 75, deixando o override só
  para casos onde a culpa percebida é claríssima.
- Mantenha `OVERRIDE_EXIGE_TRACAO = True` — desligar isso é o que mais gera ruído.

**Se estiver escapando crise real** (a equipe soube de algo que o Radar não avisou):

- Confira primeiro **por que** o caso não alertou: veja o `score_risco`, o
  `cluster_crise` e a `responsabilidade_atribuida` daquele post na planilha.
- Se era cluster intencional mas o score ficou logo abaixo do piso, baixe
  `OVERRIDE_SCORE_MIN` para 50–52.
- Se o caso era cluster **vítima** (boato/ataque) e você quer que ataques coordenados
  também alertem, isso é outra regra — peça para estender o override ao cluster vítima
  em vez de afrouxar os números deste.

**Para desligar tudo e voltar ao comportamento original:** `OVERRIDE_ALERTA_ATIVO = False`.
Nada mais precisa mudar.

---

## A regra de ouro

Não calibre no escuro. Antes de mexer, abra a planilha e olhe os posts que
alertaram (e os que não alertaram) na última semana, com a coluna `motivo_alerta`
ao lado. Ajuste com base no que **realmente aconteceu**, não em estimativa. Cada
mudança de parâmetro deve responder a um caso concreto que você viu.
