# -*- coding: utf-8 -*-
"""
boletim.py — Boletim Climático do Radar Político (camada de apresentação).

Traduz as métricas que o agora.py JÁ calcula para a metáfora climática
do Radar Comando. 100% determinístico, zero chamadas de IA.

Escala: 0–100, espelhando calc_risco() do agora.py:
    céu limpo        = baixo     (0–39)
    nuvens isoladas  = moderado  (40–59)
    tempo fechando   = alto      (60–79)
    tempestade       = crítico   (80–100)

Override: cluster "intencional" com responsabilidade >= override_resp_min
força "tempestade" (mesma filosofia do deve_disparar_alerta do agora.py).
"""

from __future__ import annotations
from typing import Optional

# Faixas espelham os níveis de calc_risco (baixo/moderado/alto/critico).
# (min, max, condicao, nivel_cor)
FAIXAS_CONDICAO = [
    (0.0,  39.9,  "ceu_limpo",       None),
    (40.0, 59.9,  "nuvens_isoladas", "amarelo"),
    (60.0, 79.9,  "tempo_fechando",  "laranja"),
    (80.0, 100.0, "tempestade",      "vermelho"),
]

# Delta diário de risco (0–100) para a previsão virar agravamento/melhora.
LIMIAR_PREVISAO = 8.0

# Risco diário mínimo para um alerta de post elevar a condição até "tempestade".
# Abaixo disso, post grave em dia calmo = "tempo fechando" (alerta pontual).
# Calibrado em 11/06/2026: post de impostos (score 75, resp 92) em dia de
# risco 38 foi julgado exagerado como tempestade.
LIMIAR_TEMPESTADE_COM_ALERTA = 60.0

TEMPLATES_FRASE = {
    "ceu_limpo":       "Céu limpo sobre Alagoinhas — situação estável",
    "nuvens_isoladas": 'Nuvens isoladas: "{tema}" merece acompanhamento',
    "tempo_fechando":  'Tempo fechando: "{tema}" em escalada',
    "tempestade":      'Tempestade: "{tema}" exige ação imediata',
}

TEMPLATES_PREVISAO = {
    "agravamento": "Tendência de agravamento se não houver resposta oficial",
    "estavel":     "Quadro estável nas próximas 24h, salvo fato novo",
    "melhora":     "Tendência de dissipação nas próximas 24h",
}

ICONES_FRENTE = [
    (0.0,  39.9,  "sol"),
    (40.0, 59.9,  "nuvem"),
    (60.0, 79.9,  "chuva"),
    (80.0, 100.0, "tempestade"),
]

ROTULOS_CLUSTER = {
    "vitima":      "Crise de vítima",
    "acidental":   "Crise acidental",
    "intencional": "Crise evitável",
    "nenhum":      "Sem crise",
}


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, float(v or 0)))


def _normalizar_faixas(faixas) -> list:
    """Aceita faixas vindas de tenant_settings ([[min,max,label,cor],...]) e
    devolve tuplas válidas. Qualquer estrutura malformada → FAIXAS_CONDICAO
    (um limiar de clima com defeito não pode derrubar o boletim)."""
    if not faixas:
        return FAIXAS_CONDICAO
    try:
        norm = []
        for f in faixas:
            lo, hi, cond = float(f[0]), float(f[1]), str(f[2])
            cor = f[3] if len(f) > 3 else None
            norm.append((lo, hi, cond, cor))
        return norm or FAIXAS_CONDICAO
    except (TypeError, ValueError, IndexError):
        return FAIXAS_CONDICAO


def _classificar(risco: float, faixas=None) -> tuple[str, Optional[str]]:
    """Classifica pelo LIMITE INFERIOR da faixa, nunca por intervalo fechado.

    As faixas são escritas como (0, 39.9), (40, 59.9), (60, 79.9), (80, 100),
    e entre elas existem BURACOS: 39.9 a 40, 59.9 a 60, 79.9 a 80. Um valor
    caindo num buraco não casava com nenhuma faixa e escorria para o fallback,
    que devolvia "tempestade" — o estado mais alarmante do produto — para um
    risco que na verdade estava na fronteira de "nuvens isoladas".

    Não é hipotético: risco 59.99999999999999 (que é como 60 costuma sair de
    uma divisão em ponto flutuante) exibia "Tempestade: exige ação imediata".
    Antes da normalização do calc_risco os valores viviam espremidos abaixo de
    65 e quase nunca tocavam essas bordas; com a escala usando os 0-100 de
    verdade, elas passam a ser atingidas com frequência.

    Ordenar por limite inferior e pegar a última faixa que começa em ou abaixo
    do valor cobre a reta inteira, sem buraco, e continua funcionando para as
    faixas customizadas que vêm de tenant_settings.climate_thresholds.
    """
    r = _clamp(risco)
    faixas_ord = sorted(_normalizar_faixas(faixas), key=lambda f: f[0])
    escolhida = faixas_ord[0]
    for faixa in faixas_ord:
        if r >= faixa[0]:
            escolhida = faixa
        else:
            break
    return escolhida[2], escolhida[3]


def icone_frente(score: float) -> str:
    """Mesmo critério de limite inferior do _classificar: ICONES_FRENTE tem os
    mesmos buracos entre faixas, e ali o fallback pintava o ícone de tempestade
    numa frente que estava na fronteira de 40 ou de 60."""
    s = _clamp(score)
    escolhido = ICONES_FRENTE[0][2]
    for lo, _hi, icone in ICONES_FRENTE:
        if s >= lo:
            escolhido = icone
        else:
            break
    return escolhido


def _previsao(serie_7d: list[float], limiar: float = LIMIAR_PREVISAO) -> str:
    if not serie_7d or len(serie_7d) < 2:
        return "estavel"
    delta = serie_7d[-1] - serie_7d[-2]
    if delta >= limiar:
        return "agravamento"
    if delta <= -limiar:
        return "melhora"
    return "estavel"


def rotulo_responsabilidade(resp: int) -> str:
    r = int(resp or 0)
    if r >= 70:
        return "alta"
    if r >= 40:
        return "média"
    return "baixa"


def gerar_boletim(
    risco: float,
    serie_7d: list[float],
    termometro: dict,
    rajadas: dict,
    frentes: list[dict],
    alerta_post: Optional[dict] = None,
    override_resp_min: int = 70,
    limiar_previsao: float = LIMIAR_PREVISAO,
    limiar_tempestade_com_alerta: float = LIMIAR_TEMPESTADE_COM_ALERTA,
    faixas=None,
) -> dict:
    """Gera o bloco `boletim` (jsonb). Determinístico e auditável.

    Args:
        risco: risco político do dia (0–100), saído de calc_risco().
        serie_7d: riscos diários dos últimos 7 dias, mais antigo primeiro.
        termometro: {"negativo_pct", "delta_pp", "media_30d"}.
        rajadas: {"mencoes_24h", "delta_pct", "origem_dominante", "origem_pct"}.
        frentes: [{"tema", "score", "tendencia"}], score 0–100,
                 tendencia em {"subindo","estavel","caindo"}.
        alerta_post: post (dict do agora.py) que disparou alerta, com
                 cluster_crise, responsabilidade_atribuida, motivo_alerta,
                 abordagem_recomendada, por_que_funciona, tema. Ou None.
        override_resp_min: espelha OVERRIDE_RESPONSABILIDADE_MIN do agora.py.
        faixas: faixas de condição de tenant_settings.climate_thresholds
                ([[min,max,label,cor],...]); None usa FAIXAS_CONDICAO padrão.
    """
    condicao, nivel_cor = _classificar(risco, faixas)

    # Flag de auditoria: o critério de override SCCT (intencional + resp alta)
    # se verificou neste alerta? (registrado mesmo quando não muda a condição)
    override = False
    if alerta_post:
        cluster = str(alerta_post.get("cluster_crise", "")).lower()
        resp = int(alerta_post.get("responsabilidade_atribuida", 0) or 0)
        override = (cluster == "intencional" and resp >= override_resp_min)

    # Elevação por alerta de post (qualquer post que passou no
    # deve_disparar_alerta do agora.py — por score ou por override SCCT):
    #   - dia também tenso (risco >= LIMIAR_TEMPESTADE_COM_ALERTA) => tempestade
    #   - dia calmo => no mínimo "tempo fechando" (alerta PONTUAL, não sistêmico)
    elevado_por_post = False
    if alerta_post:
        if _clamp(risco) >= limiar_tempestade_com_alerta:
            if condicao != "tempestade":
                elevado_por_post = True
            condicao, nivel_cor = "tempestade", "vermelho"
        elif condicao in ("ceu_limpo", "nuvens_isoladas"):
            condicao, nivel_cor = "tempo_fechando", "laranja"
            elevado_por_post = True

    frentes_ord = sorted(frentes, key=lambda f: f.get("score", 0), reverse=True)
    tema_dominante = (
        (alerta_post or {}).get("tema")
        or (frentes_ord[0]["tema"] if frentes_ord else "monitoramento geral")
    )

    previsao = _previsao(serie_7d, limiar=limiar_previsao)
    delta_24h = round(serie_7d[-1] - serie_7d[-2], 1) if len(serie_7d) >= 2 else 0.0

    alerta_ativo = None
    if alerta_post:
        cluster = str(alerta_post.get("cluster_crise", "nenhum")).lower()
        resp = int(alerta_post.get("responsabilidade_atribuida", 0) or 0)
        alerta_ativo = {
            "motivo": alerta_post.get("motivo_alerta", ""),
            "url_post": alerta_post.get("url", ""),
            "scct": {
                "cluster": cluster,
                "rotulo_cluster": ROTULOS_CLUSTER.get(cluster, cluster),
                "responsabilidade": resp,
                "rotulo_responsabilidade": rotulo_responsabilidade(resp),
            },
            "recomendacao_irt": alerta_post.get("abordagem_recomendada", ""),
            "por_que_funciona": alerta_post.get("por_que_funciona", ""),
            "override_aplicado": override,
        }

    return {
        "condicao": condicao,
        "nivel_cor": nivel_cor,
        "elevado_por_post": elevado_por_post,
        "frase_resumo": TEMPLATES_FRASE[condicao].format(tema=tema_dominante),
        "previsao_24h": previsao,
        "frase_previsao": TEMPLATES_PREVISAO[previsao],
        "pressao": {
            "valor": round(_clamp(risco), 1),
            "delta_24h": delta_24h,
            "serie_7d": [round(_clamp(v), 1) for v in serie_7d],
        },
        "termometro": termometro,
        "rajadas": rajadas,
        "frentes": [
            {**f, "icone": icone_frente(f.get("score", 0))} for f in frentes_ord
        ],
        "alerta_ativo": alerta_ativo,
    }


if __name__ == "__main__":
    import json

    exemplo = gerar_boletim(
        risco=62.0,
        serie_7d=[28.0, 30.5, 31.2, 34.0, 41.3, 55.0, 62.0],
        termometro={"negativo_pct": 34, "delta_pp": 9, "media_30d": 21},
        rajadas={"mencoes_24h": 412, "delta_pct": 18,
                 "origem_dominante": "Oposicao", "origem_pct": 62},
        frentes=[
            {"tema": "obras da orla", "score": 62.0, "tendencia": "subindo"},
            {"tema": "saude - UPA centro", "score": 34.0, "tendencia": "estavel"},
            {"tema": "iluminacao publica", "score": 18.0, "tendencia": "caindo"},
        ],
        alerta_post={
            "url": "https://instagram.com/p/xyz",
            "tema": "obras da orla",
            "cluster_crise": "intencional",
            "responsabilidade_atribuida": 78,
            "motivo_alerta": "Override SCCT — crise intencional, responsabilidade 78/100, tendencia em alta (score 62)",
            "abordagem_recomendada": "Reconhecer e apresentar plano (mortificacao + acao corretiva)",
            "por_que_funciona": "O publico atribui alta responsabilidade. Reconhecer e mostrar plano reduz o dano.",
        },
    )
    print(json.dumps(exemplo, ensure_ascii=False, indent=2))

    # ── Testes ──
    assert _classificar(0)[0] == "ceu_limpo"
    assert _classificar(39.9)[0] == "ceu_limpo"
    assert _classificar(40)[0] == "nuvens_isoladas"
    assert _classificar(60)[0] == "tempo_fechando"
    assert _classificar(80)[0] == "tempestade"
    assert _classificar(100)[0] == "tempestade"
    assert icone_frente(62) == "chuva" and icone_frente(85) == "tempestade"

    # BURACOS ENTRE FAIXAS: valores nesses intervalos nao casavam com nenhuma
    # faixa e escorriam para o fallback, que devolvia "tempestade". Ponto
    # flutuante cai neles o tempo todo (60 saindo de uma divisao vira
    # 59.99999999999999). Nao reintroduzir intervalo fechado aqui.
    assert _classificar(39.95)[0] == "ceu_limpo", "buraco 39.9-40"
    assert _classificar(59.95)[0] == "nuvens_isoladas", "buraco 59.9-60"
    assert _classificar(79.95)[0] == "tempo_fechando", "buraco 79.9-80"
    assert _classificar(59.99999999999999)[0] == "nuvens_isoladas"
    assert icone_frente(39.95) == "sol" and icone_frente(59.95) == "nuvem"

    # CALIBRACAO 11/06/2026: post grave (score 62 do exemplo) em dia de risco 62
    # => risco >= 60, alerta presente => tempestade sistemica
    assert exemplo["condicao"] == "tempestade" and exemplo["nivel_cor"] == "vermelho"
    assert exemplo["alerta_ativo"]["override_aplicado"] is True

    # Caso real de 11/06: post grave (resp 92) em dia CALMO (risco 38)
    # => tempo fechando (laranja), NAO tempestade
    caso_real = gerar_boletim(
        38.0, [30.0, 38.0], {}, {},
        [{"tema": "impostos", "score": 75.0, "tendencia": "subindo"}],
        alerta_post={"tema": "impostos", "cluster_crise": "intencional",
                     "responsabilidade_atribuida": 92,
                     "motivo_alerta": "Score risco 75 >= 70"},
    )
    assert caso_real["condicao"] == "tempo_fechando"
    assert caso_real["nivel_cor"] == "laranja"
    assert caso_real["elevado_por_post"] is True
    assert caso_real["frase_resumo"] == 'Tempo fechando: "impostos" em escalada'

    # Dia tenso (risco 65) + post grave => tempestade
    caso_sistemico = gerar_boletim(
        65.0, [60.0, 65.0], {}, {},
        [{"tema": "impostos", "score": 75.0, "tendencia": "subindo"}],
        alerta_post={"tema": "impostos", "cluster_crise": "intencional",
                     "responsabilidade_atribuida": 92},
    )
    assert caso_sistemico["condicao"] == "tempestade"

    # Sem alerta, dia calmo => ceu limpo intocado
    calmo = gerar_boletim(20.0, [22.0, 20.0], {}, {}, [])
    assert calmo["condicao"] == "ceu_limpo" and calmo["elevado_por_post"] is False

    # Sem alerta, risco 62 => tempo_fechando
    b2 = gerar_boletim(62.0, [55.0, 62.0], {}, {}, [{"tema": "x", "score": 62, "tendencia": "subindo"}])
    assert b2["condicao"] == "tempo_fechando" and b2["nivel_cor"] == "laranja"
    assert b2["previsao_24h"] == "estavel"  # delta 7.0 < 8.0

    b3 = gerar_boletim(62.0, [50.0, 62.0], {}, {}, [])
    assert b3["previsao_24h"] == "agravamento"  # delta 12 >= 8
    assert b3["frase_resumo"].startswith("Tempo fechando")

    print("\nOK — todos os testes passaram.")
