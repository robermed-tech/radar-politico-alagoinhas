# Avaz Alagoinhas — Clustering Temático e Ajuste de Alertas

**Data original:** 2026-07-03 · **Revisado:** 2026-07-03 (pós-auditoria de código)
**Projeto:** Avaz (ex-Radar Político) Alagoinhas / pipeline `agora.py`
**Origem:** Sugestão recebida via áudio (Stallone), 2026-07-03
**Status:** Em grande parte **já implementado** — falta ativar o toggle e calibrar

> **Nota de revisão.** A primeira versão (em `Downloads/radar-politico-plano-clustering-alertas.md`) tratava o alerta temático como algo a construir do zero. A auditoria de 2026-07-03 mostrou que **a lógica já existe no `agora.py`** (`verificar_alertas`), apenas desligada por padrão. Esta versão corrige a premissa e reduz a entrega ao que de fato falta: ativar e calibrar.

---

## 1. Problema identificado (premissa corrigida)

**Premissa original:** "o sistema dispara alerta a partir de comentários isolados com sentimento negativo".

**Correção da auditoria:** isso **não corresponde ao código**. Alertas disparam por **post** com `score_risco ≥ 70` ou pelo override SCCT (`deve_disparar_alerta`), com cap de 3 por run, mensagem única consolidada, dedup por mudança real e throttle de 6h. Um comentário isolado não dispara nada.

O incômodo relatado no áudio ("mira no ar... uma pessoa diz que está ruim, aí liga o alerta") provavelmente vem de **posts individuais** de risco alto com pouca tração de público — problema real, mas de diagnóstico diferente do descrito. O alerta **temático por volume** (abaixo) é a resposta certa para isso, e já está no código.

## 2. Objetivo da mudança

Privilegiar o disparo por **tema recorrente com volume mínimo** em vez de post individual isolado — inspirado na sumarização por assunto de marketplaces (ex.: "70% elogiaram, 30% reclamaram do prazo").

## 3. Estado real no `agora.py` (o que já existe)

### 3.1. Alerta temático — JÁ IMPLEMENTADO (`verificar_alertas`)

```python
# Tema com >= 3 posts e negatividade >= limiar dispara alerta.
tema_map = {}   # {tema: {neg, tot, coments}}
for p in posts_analisados:
    t = p.get("tema", "")
    if not t or t == "—": continue
    tema_map.setdefault(t, {"neg": 0, "tot": 0, "coments": 0})
    tema_map[t]["tot"] += 1
    tema_map[t]["coments"] += int(p.get("comentarios_total", 0) or 0)
    if _sent(p) == "negativo": tema_map[t]["neg"] += 1

if ativo_tema:                      # <-- desligado por padrão (tema_ativo=False)
    for tema, v in tema_map.items():
        if v["tot"] < 3: continue   # <-- o "volume mínimo" pedido no doc
        pneg = round(v["neg"] / v["tot"] * 100)
        if pneg >= limiar_tema:     # limiar default 50%
            alertas.append(f"⚡ Tema '{tema}' com {pneg}% negativo em {v['tot']} posts "
                           f"({v['coments']} comentários) — ... Preocupação coletiva, "
                           f"não menção isolada.")
```

Diferenças em relação ao plano original:
- O "volume mínimo" já existe (`v["tot"] < 3`), mas conta **posts** do tema, não comentários. Isso é mais robusto: reaproveita a classificação temática que já existe **no post** (o modelo de dados não tem tema por comentário, então o pseudocódigo original `c["tema_classificado"]` não compilaria).
- A janela é o conjunto de posts que o run enxerga (`DIAS_RETROATIVOS`), não uma nova constante `JANELA_TEMPO_HORAS`.
- A mensagem (desde 2026-07-03) já traz nº de posts **e** de comentários, atendendo à seção 3.4 do plano original.

### 3.2. Configuração — JÁ IMPLEMENTADA (`tenant_settings`)

Os parâmetros já são lidos de `tenant_settings.notification_config`, ajustáveis pela UI (Admin → Notificações), com fallback para env:
```python
limiar_tema = int(_nc.get("tema_limiar", os.environ.get("ALERTA_TEMA_LIMIAR", 50)))
ativo_tema  = bool(_nc.get("tema_ativo", False))
```
O RBAC citado como "próximo passo natural" no plano original **já está em produção**.

### 3.3. Boletim climático — JÁ é temático e escala intensidade

`_frentes_por_tema` + faixas de condição em `boletim.py` (chuva 60-79, tempestade 80-100) já traduzem risco por tema em metáfora climática. Escalar por contagem de menções seria mudança de política de cálculo, não uma lacuna.

## 4. O que de fato falta (a entrega real)

1. **Ativar** o toggle "Tema em crise por sentimento" em Configuração → Notificações (`tema_ativo = true`).
2. **Calibrar** o `tema_limiar` — dry-run sobre dados reais (116 posts, últimos 30 dias) indica:

   | Limiar | Dias com alerta (de 14) | Temas |
   |---|---|---|
   | 40% | 6 | saúde, cultura_eventos, comunicação, obras |
   | **50% (default)** | **6** | cultura_eventos, comunicação, saúde, obras |
   | 60% | 3 | comunicação, saúde, obras |
   | 70% | 0 | nenhum (estrito demais) |

   Recomendação: começar em **50%**, subir para 60% se incomodar. O throttle de 6h já limita a 1 alerta automático por ciclo.

## 5. Passo a passo (atualizado)

1. ~~Backup/branch, novas constantes, nova função, nova lógica~~ — **desnecessário, já existe.**
2. Ativar `tema_ativo` pela UI (Admin → Notificações) — sem alterar código.
3. Observar por alguns ciclos e ajustar `tema_limiar` se necessário.
4. (Opcional) Adicionar um piso de **comentários** além dos 3 posts, se quiser exigir tração mínima de público.

## 6. Critério de sucesso

- Alertas temáticos correspondem a temas com repetição real (3+ posts).
- Boletim/WhatsApp comunica volume + tema ("obras: 67% negativo em 3 posts, 142 comentários"), não "negativo genérico". ✅ já implementado.

## 7. Correções factuais ao documento original

- GitHub Actions roda **3× por dia** (11h, 17h, 22h UTC), não 4×.
- A coleta atual é **Instagrapi (primário) + Apify (fallback)**, não só Apify.
- A "lógica de comentário isolado → alerta" descrita como estado atual **nunca existiu** nessa forma; alertas sempre foram por post/score.
