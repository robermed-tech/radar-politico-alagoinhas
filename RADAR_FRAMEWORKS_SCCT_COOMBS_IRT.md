# Radar Político Alagoinhas — Frameworks SCCT, Coombs e IRT no Pipeline

**Data original:** 2026-07-03 · **Revisado:** 2026-07-03 (pós-auditoria de código)
**Projeto:** Radar Político Alagoinhas / pipeline `agora.py`
**Status:** Documento de formalização — base para posicionamento e para validação técnica

> **Nota de revisão.** A primeira versão deste documento (em `Downloads/radar-politico-frameworks-scct-coombs-irt.md`) descrevia Coombs e IRT como "não implementados". A auditoria do código-fonte em 2026-07-03 mostrou que **Coombs já estava implementado** e, na mesma data, **IRT e a exposição de SCCT por post foram concluídos e colocados em produção**. Esta versão corrige o status de cada framework com o mapeamento real para funções do `agora.py`. Os "próximos passos" de implementação do documento original foram todos executados.

---

## 1. Objetivo do documento

Formalizar como os três frameworks de comunicação de crise — SCCT, Coombs e IRT — operam dentro do pipeline do Radar, de forma que:

- sirvam de argumento de diferenciação comercial ("solução científica de gestão de crise política", não apenas um dashboard de listening);
- possam ser auditados tecnicamente (mapeados a funções específicas do código);
- orientem melhorias futuras de classificação e resposta.

## 2. Visão geral do fluxo

```
Post + comentários captados (Instagrapi primário + Apify fallback)
        │
        ▼
Análise via Claude API (triagem Haiku → análise profunda Sonnet)
        │
        ▼
[SCCT] cluster_crise + responsabilidade_atribuida (por post)
        │
        ▼
[Coombs] abordagem_recomendada (determinística, por cluster)
        │
        ▼
Dashboard (Radar Comando): card SCCT no Feed + boletim climático + Alertas & Ações
        │
        ▼
Resposta da equipe de comunicação (fora do sistema)
        │
        ▼
[IRT] temas_monitorados: acompanhamento de recuperação nos runs seguintes
```

## 3. SCCT — Situational Crisis Communication Theory (Coombs)

**Função:** classificar o **tipo e a severidade** da crise a partir do conteúdo capturado.

| Categoria SCCT | Descrição | Exemplo no contexto municipal |
|---|---|---|
| Vítima | A prefeitura é alvo, não causa | Boato ou ataque infundado |
| Acidental | Falha não intencional, sem culpa direta | Problema técnico, atraso não planejado |
| Intencional/Culpabilidade | Falha evitável, responsabilidade clara | Obra mal executada, promessa não cumprida |

**Status:** ✅ **Implementado e em produção.**

**Mapeamento no código (`agora.py`):**
- `PROMPT_SISTEMA` + `montar_prompt` — o Claude atribui `cluster_crise` (vitima/acidental/intencional/nenhum) e `responsabilidade_atribuida` (0-100) a cada post. Desde 2026-07-03 o prompt cita a SCCT nominalmente (rastreabilidade — item 8.3 do doc original).
- `deve_disparar_alerta` — **override de alerta SCCT**: dispara crises intencionais de alta responsabilidade mesmo quando o score de risco fica abaixo do limiar padrão (posts de oposição eficazes ficam ~62, abaixo de 70).
- Espelhamento no dashboard: colunas `cluster_crise`, `responsabilidade_atribuida`, `confianca`, `abordagem_recomendada`, `por_que_funciona`, `motivo_alerta` na tabela `posts`; card SCCT no Feed ("O que o povo diz").

## 4. Coombs — Crisis Response Strategies

**Função:** a partir do tipo de crise (SCCT), sugerir a **estratégia de resposta** apropriada.

| Cluster SCCT | Estratégia Coombs | Abordagem gerada pelo sistema |
|---|---|---|
| Vítima | Esclarecimento factual (negação factual + ação corretiva) | "Esclarecer com evidência factual" |
| Acidental | Diminish (correção + contextualização) | "Corrigir e contextualizar" |
| Intencional/Culpabilidade | Rebuild (mortificação + ação corretiva) | "Reconhecer e apresentar plano" |

**Status:** ✅ **Implementado e em produção** (a primeira versão do documento afirmava incorretamente que não estava).

**Mapeamento no código (`agora.py`):**
- `ABORDAGEM_POR_CLUSTER` (dicionário) + `recomendar_abordagem(cluster)` — mapeamento determinístico e auditável cluster → estratégia, exatamente na forma que o pseudocódigo `ESTRATEGIA_COOMBS` do documento original propunha, porém mais completo: além da abordagem, retorna `por_que_funciona` (justificativa exibível).
- O módulo declara na origem: *"Baseado em: SCCT (Coombs) + Image Repair Theory (Benoit)"*.
- Saídas: card do Feed, boletim climático (`recomendacao_irt` em `boletim.py`), alerta WhatsApp (`*SCCT:* {abordagem}`) e planos do Caçador de Crises (página Alertas & Ações).

**Exemplo real capturado em produção (03/07/2026):**
```
cluster: intencional ("Crise evitável")  ·  responsabilidade: 91/100
recomendação: "Reconhecer e apresentar plano (mortificação + ação corretiva)"
```

## 5. IRT — Image Restoration Theory (Benoit)

**Função:** após a resposta da prefeitura, **monitorar a recuperação de reputação** ao longo dos dias seguintes.

**Status:** ✅ **Implementado em 2026-07-03** (era o principal gap real da auditoria).

**Mapeamento no código:**
- Tabela `temas_monitorados` (`supabase/scct_posts_e_irt.sql`): quando um tema dispara alerta, seu pico é registrado (volume e % negativo).
- `atualizar_temas_monitorados(posts_analisados, temas_alertados)` em `agora.py` — roda a cada ciclo: compara o volume atual do tema com o pico e marca:
  - **tendência:** `em_queda` (≤50% do pico) / `estavel` / `em_alta`;
  - **status:** `recuperado` (3+ dias em queda — resposta funcionou) ou `persistente` (7+ dias sem queda — resposta não efetiva).
- Dashboard: painel "Recuperação pós-alerta" na página Previsões (ex.: *"obras — pico em 01/07, volume 4→2 posts, em queda ✓ Recuperado"*). Só aparece quando há tema em monitoramento.

Blocos de apoio que já existiam e alimentam o IRT: `daily_themes` (volume+sentimento por dia/tema), `narratives` (status ativa/esfriando/encerrada) e os slopes de tendência da página Previsões.

## 6. Resumo do status de implementação (atualizado)

| Framework | Status original (doc) | Status real (auditoria 03/07) |
|---|---|---|
| SCCT | ✅ Implementado | ✅ Implementado + override de alerta + exposto por post no dashboard |
| Coombs | ⚠️ "Não implementado" | ✅ **Já estava implementado** (`ABORDAGEM_POR_CLUSTER`/`recomendar_abordagem`) |
| IRT | ⚠️ Não implementado | ✅ **Implementado em 03/07** (`temas_monitorados` + painel Previsões) |

## 7. Valor de posicionamento

Com as três camadas em produção, o discurso comercial do Radar é:

> "Identificamos o tipo de crise (SCCT), recomendamos a estratégia de resposta baseada em teoria consolidada de comunicação (Coombs), e acompanhamos se a reputação está se recuperando (IRT) — tudo automatizado e específico para gestão pública municipal."

Diferencial que ferramentas genéricas de listening (Stilingue, Brandwatch, Sprinklr) não oferecem prontas para o contexto de crise política. **Este argumento é integralmente defensável hoje** — não depende mais de trabalho futuro.

## 8. Próximos passos (todos os originais concluídos)

1. ~~Implementar o mapeamento Coombs~~ — **já existia** (`recomendar_abordagem`).
2. ~~Implementar o acompanhamento IRT~~ — **concluído 03/07** (`temas_monitorados`).
3. ~~Revisar prompts para citar SCCT~~ — **concluído 03/07**.
4. Integrar esta documentação ao material de venda/apresentação do Radar como serviço (pendência de negócio, não de código).

**Novos passos sugeridos pela auditoria (opcionais):**
- Ativar o alerta temático (toggle "Tema em crise por sentimento" em Configuração → Notificações); calibração por dry-run recomenda limiar 50%.
- Enriquecer o painel IRT com o % negativo além do volume, quando houver histórico suficiente.
