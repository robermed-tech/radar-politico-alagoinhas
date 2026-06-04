# Radar Político — Arquitetura Multi-Agente

> Evolução de **1 agente** (Claude Haiku fazendo 2 tarefas) para uma **equipe de
> agentes especializados** orquestrados, cada um com função, modelo e gatilho próprios.
> Princípio central: **custo controlado** — agentes caros só disparam quando necessário.

---

## 1. Princípio: Orquestrador + Agentes Condicionais

O erro comum em multi-agente é rodar TODOS os agentes a cada execução → custo explode.
Aqui, um **Orquestrador** decide quais agentes acordar, com base no que os dados mostram.

```
                    ┌──────────────────────────────────────┐
   Apify (coleta) → │           ORQUESTRADOR               │
                    │  (decide quem acorda, com que dados)  │
                    └──────────────────────────────────────┘
                          │            │             │
              ┌───────────┘            │             └───────────┐
              ▼                        ▼                         ▼
      TIER 1 (sempre)          TIER 2 (condicional)       TIER 3 (1x/dia)
      ┌─────────────┐          ┌──────────────────┐       ┌──────────────┐
      │  Analista   │          │ Caçador de Crises│       │ Estrategista │
      │  (Haiku)    │          │ Monitor Oposição │       │  (Sonnet)    │
      │ 1 call/post │          │ Redator          │       │ 1 call/dia   │
      └─────────────┘          │ Verificador      │       └──────────────┘
                               └──────────────────┘
                               (só disparam se gatilho)
```

---

## 2. Roster de Agentes

| # | Agente | Papel | Modelo | Gatilho | Custo |
|---|--------|-------|--------|---------|-------|
| 1 | **Analista** | Classifica cada post + comentários (sentimento, tema, queixa, score) | Haiku | Sempre (1×/post) | Alto volume, barato |
| 2 | **Caçador de Crises** | Investiga posts de alto risco, decide nível, redige plano de contenção | Sonnet | `score_risco ≥ 70` OU `risco_crise = alto` | Raro |
| 3 | **Monitor de Oposição** | Rastreia perfis opositores, detecta ataques coordenados, mapeia narrativa adversária | Sonnet | Post de categoria `Oposicao` com engajamento alto OU coordenação detectada | Médio |
| 4 | **Redator** | Escreve rascunhos de resposta/post para o gabinete (rebater crítica, amplificar positivo) | Sonnet | Crise aberta OU oportunidade de alto impacto | Raro |
| 5 | **Verificador** | Checa se queixa viral tem base factual (vale responder?) | Haiku | Comentário negativo com muitas curtidas | Médio |
| 6 | **Estrategista** | Briefing diário: diagnóstico + oportunidades + recomendações | Sonnet | 1×/dia (consolida tudo) | 1×/dia |

> **Hoje existem:** Analista (#1) e Estrategista (#6). Os 4 do meio são os novos.

---

## 3. Detalhe de cada agente novo

### 🚨 Agente Caçador de Crises
- **Entrada:** post + todos os comentários + histórico de risco (daily_metrics)
- **Faz:** confirma se é crise real (não falso-alarme), classifica nível (baixo→crítico),
  identifica o "pavio" (qual comentário/fato disparou), estima velocidade de propagação.
- **Saída JSON:**
  ```json
  {
    "e_crise_real": true,
    "nivel": "alto",
    "pavio": "comentário sobre falta de remédio com 312 curtidas",
    "velocidade": "acelerando",
    "janela_resposta": "24h",
    "plano_contencao": ["passo 1...", "passo 2..."],
    "risco_se_ignorar": "viralização para imprensa local em 48h"
  }
  ```
- **Vai para:** Central de Crises + alerta WhatsApp prioritário.

### 🎯 Agente Monitor de Oposição
- **Entrada:** posts de perfis opositores + comentários + grupos coordenados
- **Faz:** identifica a narrativa que a oposição está construindo, quem são os
  amplificadores, se há coordenação, qual o ângulo de ataque.
- **Saída JSON:**
  ```json
  {
    "narrativa_oposicao": "prefeito gasta com São João e abandona zona rural",
    "angulo_ataque": "contraste festa vs. necessidade básica",
    "amplificadores": ["@perfil1", "@perfil2"],
    "coordenado": true,
    "contra_narrativa_sugerida": "mostrar investimento rural com números"
  }
  ```
- **Vai para:** Narrativas + Assistente IA.

### ✍️ Agente Redator
- **Entrada:** crise/oportunidade + tom da gestão + diretrizes de comunicação
- **Faz:** escreve 2-3 rascunhos prontos (story, post, nota oficial, resposta a comentário).
- **Saída JSON:**
  ```json
  {
    "rascunhos": [
      {"canal": "Instagram Stories", "texto": "...", "tom": "próximo", "cta": "..."},
      {"canal": "Nota oficial", "texto": "...", "tom": "institucional"}
    ]
  }
  ```
- **Vai para:** nova aba "Sala de Redação" no app (rascunhos copiáveis).
- ⚠️ **Nunca publica** — só gera rascunho para humano revisar e postar.

### 🔍 Agente Verificador
- **Entrada:** comentário negativo viral + caption do post
- **Faz:** avalia se a queixa é factual, exagerada ou falsa; sugere se vale responder.
- **Saída JSON:**
  ```json
  {
    "tipo": "factual" | "exagero" | "desinformacao",
    "vale_responder": true,
    "abordagem": "reconhecer + mostrar ação em andamento"
  }
  ```
- **Vai para:** prioriza a fila do Redator.

---

## 4. Lógica do Orquestrador (pseudocódigo)

```python
def orquestrar(posts_analisados, comentarios, historico):
    # TIER 1 já rodou (Analista classificou todos os posts)

    crises = []
    for post in posts_analisados:
        # GATILHO Caçador de Crises
        if post.score_risco >= 70 or post.risco_crise == "alto":
            crises.append(agente_cacador_crises(post, comentarios, historico))

        # GATILHO Monitor de Oposição
        if post.categoria == "Oposicao" and post.engajamento_alto:
            agente_monitor_oposicao(post, comentarios, grupos_coordenados)

    # GATILHO Verificador (comentários virais negativos)
    virais_neg = top_comentarios_negativos(comentarios, min_curtidas=50)
    for c in virais_neg:
        veredito = agente_verificador(c)
        if veredito.vale_responder:
            fila_redator.append(c)

    # GATILHO Redator (só se há crise OU oportunidade priorizada)
    if crises or fila_redator:
        agente_redator(crises, fila_redator, diretrizes)

    # TIER 3 (sempre, 1×/dia): Estrategista consolida tudo
    agente_estrategista(posts_analisados, crises, narrativas, historico)
```

**Custo típico de um run sem crise:** Tier 1 (N posts) + Tier 3 (1) = igual a hoje.
**Custo em dia de crise:** + 1-3 chamadas Sonnet (Caçador + Redator). Controlado.

---

## 5. Modelo de Dados (novas tabelas)

```sql
-- Registro de execução de cada agente (auditoria + custo)
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant text default 'alagoinhas',
  agente text,                    -- analista|cacador_crises|monitor_oposicao|redator|verificador|estrategista
  modelo text,                    -- haiku|sonnet
  gatilho text,                   -- o que disparou
  input_ref text,                 -- post.url ou 'dia'
  output jsonb,
  tokens_in int, tokens_out int,
  custo_usd numeric,
  criado_em timestamptz default now()
);

-- Rascunhos do Redator (Sala de Redação)
create table drafts (
  id uuid primary key default gen_random_uuid(),
  tenant text default 'alagoinhas',
  origem text,                    -- crise|oportunidade
  canal text, texto text, tom text, cta text,
  status text default 'rascunho', -- rascunho|aprovado|publicado|descartado
  criado_em timestamptz default now()
);
```

---

## 6. Custo — análise honesta

| Cenário | Hoje (1 agente) | Multi-agente |
|---|---|---|
| Dia calmo (sem crise) | ~10 calls Haiku + 1 Sonnet | **Igual** (gatilhos não disparam) |
| Dia com 1 crise | ~10 Haiku + 1 Sonnet | + 2 Sonnet (Caçador + Redator) |
| Dia de ataque coordenado | idem | + 3-4 Sonnet (Monitor + Redator + Verificadores) |

**Estimativa:** custo sobe ~15-30% só nos dias agitados (que é quando vale a pena).
Em dias normais, custo praticamente igual. **Sonnet é ~12× Haiku**, por isso os
agentes Sonnet são **condicionais e raros**.

---

## 7. Como aparece no app (novas telas)

| Agente | Onde aparece |
|---|---|
| Caçador de Crises | Card "Plano de Contenção" dentro da Central de Crises |
| Monitor de Oposição | Seção "Inteligência Adversária" em Narrativas |
| Redator | **Nova aba "Sala de Redação"** — rascunhos prontos para copiar |
| Verificador | Selo "factual / exagero / desinformação" nos comentários |
| Estrategista | Assistente IA (já existe) |
| Painel de Agentes | **Nova aba "Agentes"** — o que cada um fez hoje, custo, auditoria |

---

## 8. Rollout incremental (NÃO reescrever — adicionar 1 agente por vez)

| Fase | Entrega | Esforço | Status |
|---|---|---|---|
| A | Tabela `agent_runs` + auditoria de execução | P | ✅ Feito (junto da B) |
| B | **Agente Caçador de Crises** + card de contenção | M | ✅ **Feito** (commit 035ce1e/34c2276) |
| C | **Agente Redator** + Sala de Redação | M | ⏳ Próxima atualização |
| D | **Agente Monitor de Oposição** + Inteligência Adversária | M | ⏳ Backlog |
| E | **Agente Verificador** + selos nos comentários | P | ⏳ Backlog |
| F | Painel de Agentes (auditoria + custo) | P | ⏳ Backlog |

Cada fase é independente e reversível. O pipeline atual continua funcionando o tempo todo.

### Estado em 04/06/2026
- **2 agentes ativos:** Analista (Haiku) + Caçador de Crises (Haiku/Sonnet) + Estrategista (Haiku).
- Caçador validado em produção: separou 1 crise real (vacinação @prefeituraalagoinhas)
  de 2 falso-alarmes da oposição (obras/tarifa, risco alto mas sem massa).
- Tabelas no Supabase: agent_runs, crisis_plans (+ todas as fases anteriores).
- Para retomar a Fase C: o Redator consome `crisis_plans` (crises reais) + diretrizes
  de comunicação → grava em `drafts` → nova aba "Sala de Redação". Spec na seção 3.

---

## 9. Riscos & cuidados

- **Custo descontrolado:** mitigado por gatilhos condicionais + modelos certos por tarefa.
- **Alucinação em conteúdo público:** o Redator NUNCA publica — só gera rascunho p/ humano.
- **Loop de agentes:** orquestrador é linear (sem agentes chamando agentes em loop).
- **Latência:** agentes Sonnet são mais lentos; por isso são poucos e condicionais.
- **Auditoria:** `agent_runs` registra tudo (quem rodou, por quê, custo) — transparência total.

---

## 10. Recomendação de início

Começar pela **Fase B — Agente Caçador de Crises**. É o de maior valor para o gabinete
(transforma "risco alto detectado" em "plano de ação concreto") e o gatilho é raro
(só dispara em crise real), então o custo extra é mínimo. Depois o Redator (Fase C),
que fecha o ciclo: detectar crise → gerar resposta pronta.
