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


def _classificar(risco: float) -> tuple[str, Optional[str]]:
    r = _clamp(risco)
    for lo, hi, condicao, cor in FAIXAS_CONDICAO:
        if lo <= r <= hi:
            return condicao, cor
    return "tempestade", "vermelho"  # r > 99.9 por arredondamento


def icone_frente(score: float) -> str:
    s = _clamp(score)
    for lo, hi, icone in ICONES_FRENTE:
        if lo <= s <= hi:
            return icone
    return "tempestade"


def _previsao(serie_7d: list[float]) -> str:
    if not serie_7d or len(serie_7d) < 2:
        return "estavel"
    delta = serie_7d[-1] - serie_7d[-2]
    if delta >= LIMIAR_PREVISAO:
        return "agravamento"
    if delta <= -LIMIAR_PREVISAO:
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
    """
    condicao, nivel_cor = _classificar(risco)

    override = False
    if alerta_post:
        cluster = str(alerta_post.get("cluster_crise", "")).lower()
        resp = int(alerta_post.get("responsabilidade_atribuida", 0) or 0)
        override = (cluster == "intencional" and resp >= override_resp_min)
    if override:
        condicao, nivel_cor = "tempestade", "vermelho"

    frentes_ord = sorted(frentes, key=lambda f: f.get("score", 0), reverse=True)
    tema_dominante = (
        (alerta_post or {}).get("tema")
        or (frentes_ord[0]["tema"] if frentes_ord else "monitoramento geral")
    )

    previsao = _previsao(serie_7d)
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

    # Override: risco baixo mas crise intencional resp>=70 => tempestade
    assert exemplo["condicao"] == "tempestade" and exemplo["nivel_cor"] == "vermelho"
    assert exemplo["alerta_ativo"]["override_aplicado"] is True

    # Sem alerta, risco 62 => tempo_fechando
    b2 = gerar_boletim(62.0, [55.0, 62.0], {}, {}, [{"tema": "x", "score": 62, "tendencia": "subindo"}])
    assert b2["condicao"] == "tempo_fechando" and b2["nivel_cor"] == "laranja"
    assert b2["previsao_24h"] == "estavel"  # delta 7.0 < 8.0

    b3 = gerar_boletim(62.0, [50.0, 62.0], {}, {}, [])
    assert b3["previsao_24h"] == "agravamento"  # delta 12 >= 8
    assert b3["frase_resumo"].startswith("Tempo fechando")

    print("\nOK — todos os testes passaram.")
