# -*- coding: utf-8 -*-
"""
acuracia.py — medição de acurácia do classificador de sentimento contra rótulo humano.

Resolve o item 2.10 da auditoria de 26/07: "todo o valor do produto repousa na
classificação de sentimento, e não existe conjunto rotulado por pessoa para
comparar". Sem isso não há resposta para a pergunta que todo comprador sério
faz: "qual a taxa de erro disso?".

POR QUE UM HUMANO PRECISA ROTULAR
    Reclassificar a amostra com o mesmo modelo (ou com outro modelo) mede
    AUTOCONSISTÊNCIA, não acurácia: o classificador vira o próprio gabarito e
    todo erro sistemático passa despercebido, porque ele erra igual nas duas
    vezes. O `--teste-sentimento` do agora.py serve para medir DERIVA entre
    versões do critério, e é útil para isso; ele não substitui gabarito humano.
    Acurácia exige uma referência externa ao sistema medido.

DESENHO DA AMOSTRA
    Amostragem ALEATÓRIA ESTRATIFICADA pela classe que o modelo previu.
    Na base real (2.247 comentários de cidadão) as classes são muito
    desbalanceadas: negativo 46,9%, neutro 42,3%, positivo 10,8%. Uma amostra
    aleatória simples de 300 traria só cerca de 32 positivos, o que não sustenta
    nenhuma afirmação sobre a classe positiva.

    Estratificar pela PREDIÇÃO tem uma vantagem específica: a precisão de cada
    classe sai direto do estrato, sem ponderação nenhuma (de tudo que o modelo
    chamou de negativo, quanto era mesmo negativo). Para as quantidades
    populacionais (revocação, acurácia geral, kappa) os estratos são
    reponderados por N_h/n_h, que é o peso amostral correto.

CEGUEIRA
    A planilha de rotulagem NÃO mostra o que o modelo respondeu. Rotulador que
    vê o palpite da máquina concorda com ela por ancoragem, e a medição perde o
    sentido. O gabarito do modelo fica num arquivo separado e só é reunido ao
    rótulo humano na hora de calcular.

Módulo puro: não faz rede, não lê ambiente. O IO fica no agora.py.
"""

from __future__ import annotations

import csv
import html
import json
import math
import random
from collections import defaultdict

CLASSES = ("positivo", "negativo", "neutro")

# Espelha CONFIANCA_MIN_SENTIMENTO (agora.py) e CONFIANCA_MIN (sentimento.ts):
# abaixo disso o comentário não conta como crítica nem como elogio no painel.
# A acurácia é reportada duas vezes, com e sem esse corte, porque o número que
# importa para o clima é o do subconjunto que de fato entra na conta.
CONFIANCA_MIN = 50


# ==============================================================
# 1. AMOSTRAGEM
# ==============================================================

def montar_amostra(comentarios, por_estrato=100, semente=42):
    """Sorteia uma amostra estratificada pela classe PREVISTA pelo modelo.

    `comentarios`: lista de dicts com ao menos id, texto, sentimento.
    Retorna (amostra, estratos) onde:
      amostra  = lista de dicts prontos para rotulagem (sem o rótulo do modelo)
      estratos = {classe: {"N": tamanho no universo, "n": tamanho na amostra}}

    A semente fixa deixa o sorteio reproduzível: rodar de novo devolve a mesma
    amostra, o que permite continuar uma rotulagem interrompida sem embaralhar.
    """
    rng = random.Random(semente)

    por_classe = defaultdict(list)
    for c in comentarios:
        s = (c.get("sentimento") or "neutro").lower()
        if s not in CLASSES:
            s = "neutro"
        if not (c.get("texto") or "").strip():
            continue  # comentário já expurgado pela retenção não pode ser rotulado
        por_classe[s].append(c)

    amostra, estratos = [], {}
    for classe in CLASSES:
        pool = por_classe.get(classe, [])
        n = min(por_estrato, len(pool))
        # N_conf: tamanho do estrato RESTRITO aos comentarios que entram no
        # clima (confianca >= CONFIANCA_MIN). Sem esse numero, o relatorio
        # restrito reponderaria a subamostra confiante pela populacao inteira
        # do estrato, extrapolando de um subconjunto para um universo maior do
        # que ele representa e inflando o resultado.
        n_conf = sum(1 for c in pool if int(c.get("confianca_tema") or 0) >= CONFIANCA_MIN)
        estratos[classe] = {"N": len(pool), "n": n, "N_conf": n_conf}
        amostra.extend(rng.sample(pool, n) if n else [])

    # Embaralha a ordem final para o rotulador não perceber os blocos por
    # classe: sequência de 100 negativos seguidos induz a resposta.
    rng.shuffle(amostra)
    return amostra, estratos


# ==============================================================
# 2. MÉTRICAS
# ==============================================================

def _wilson(acertos, total, z=1.96):
    """Intervalo de confiança de Wilson para uma proporção.

    Usado em vez do intervalo normal porque com n pequeno por classe (100) e
    proporção perto de 1 o intervalo normal estoura acima de 100% e passa uma
    precisão que o dado não sustenta.
    """
    if total == 0:
        return (0.0, 0.0)
    p = acertos / total
    d = 1 + z * z / total
    centro = (p + z * z / (2 * total)) / d
    margem = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return (max(0.0, centro - margem) * 100, min(1.0, centro + margem) * 100)


def calcular_metricas(pares, estratos, so_confiantes=False):
    """Calcula as métricas a partir dos pares (previsto, verdadeiro).

    `pares`: lista de dicts {previsto, verdadeiro, confianca}.
    `estratos`: saída de montar_amostra, com N e n por classe prevista.
    `so_confiantes`: restringe aos comentários com confianca >= CONFIANCA_MIN,
    que são os que de fato entram no cálculo do clima.

    Devolve um dict com matriz de confusão ponderada, precisão, revocação, F1,
    acurácia geral e kappa de Cohen.
    """
    usados = [
        p for p in pares
        if p.get("previsto") in CLASSES and p.get("verdadeiro") in CLASSES
        and (not so_confiantes or int(p.get("confianca") or 0) >= CONFIANCA_MIN)
    ]

    # Contagem bruta por estrato (previsto), necessária para o peso amostral.
    bruto = defaultdict(lambda: defaultdict(int))
    n_estrato = defaultdict(int)
    for p in usados:
        bruto[p["previsto"]][p["verdadeiro"]] += 1
        n_estrato[p["previsto"]] += 1

    # Peso: cada comentário rotulado do estrato h representa N_h/n_h do universo.
    # Sem isso a acurácia geral ficaria enviesada, porque a amostra tem 100
    # positivos para 243 do universo e 100 negativos para 1.054.
    #
    # Quando o recorte é "só os confiantes", o universo TAMBÉM encolhe: a
    # população de interesse passa a ser só o que entra no clima. Usar o N
    # cheio aqui extrapolaria a subamostra confiante para um universo maior do
    # que ela representa, e inflaria o número justamente no bloco que o
    # relatório apresenta como o mais importante.
    chave_N = "N_conf" if so_confiantes else "N"
    peso = {}
    for classe in CLASSES:
        est = estratos.get(classe, {})
        N = est.get(chave_N, est.get("N", 0))
        n = n_estrato.get(classe, 0)
        peso[classe] = (N / n) if n else 0.0

    matriz = {prev: {verd: bruto[prev][verd] * peso[prev] for verd in CLASSES} for prev in CLASSES}
    total_pond = sum(matriz[a][b] for a in CLASSES for b in CLASSES)

    metricas = {}
    for classe in CLASSES:
        # Precisão sai direto do estrato, sem peso: dentro de um estrato a
        # amostra é aleatória simples, então a proporção observada já estima a
        # proporção do estrato.
        acertos_brutos = bruto[classe][classe]
        total_brutos = n_estrato.get(classe, 0)
        precisao = (acertos_brutos / total_brutos * 100) if total_brutos else 0.0
        ic = _wilson(acertos_brutos, total_brutos)

        # Revocação precisa da população: de tudo que É da classe, quanto o
        # modelo pegou. Os verdadeiros da classe estão espalhados por todos os
        # estratos, então aqui o peso é obrigatório.
        verdadeiros_pond = sum(matriz[prev][classe] for prev in CLASSES)
        recuperados_pond = matriz[classe][classe]
        revocacao = (recuperados_pond / verdadeiros_pond * 100) if verdadeiros_pond else 0.0

        f1 = (2 * precisao * revocacao / (precisao + revocacao)) if (precisao + revocacao) else 0.0

        metricas[classe] = {
            "precisao": precisao, "precisao_ic": ic, "revocacao": revocacao, "f1": f1,
            "n_amostra": total_brutos, "acertos": acertos_brutos,
            "suporte_pond": verdadeiros_pond,
        }

    acuracia = (sum(matriz[c][c] for c in CLASSES) / total_pond * 100) if total_pond else 0.0

    # Kappa de Cohen sobre a matriz ponderada: desconta o acerto que sairia do
    # acaso. Num problema com uma classe dominante a acurácia crua engana, e o
    # kappa é o número que sobrevive a essa crítica.
    if total_pond:
        p_obs = acuracia / 100
        p_esp = sum(
            (sum(matriz[c][v] for v in CLASSES) / total_pond)
            * (sum(matriz[p][c] for p in CLASSES) / total_pond)
            for c in CLASSES
        )
        kappa = (p_obs - p_esp) / (1 - p_esp) if (1 - p_esp) else 0.0
    else:
        kappa = 0.0

    return {
        "matriz": matriz, "por_classe": metricas, "acuracia": acuracia,
        "kappa": kappa, "n_rotulados": len(usados), "total_pond": total_pond,
        "so_confiantes": so_confiantes,
    }


def formatar_relatorio(res):
    """Relatório de texto para o terminal."""
    L = []
    escopo = ("somente confianca >= %d (os que entram no clima)" % CONFIANCA_MIN
              if res["so_confiantes"] else "todos os comentarios rotulados")
    L.append(f"\n=== ACURACIA CONTRA ROTULO HUMANO ({escopo}) ===")
    L.append(f"  {res['n_rotulados']} comentarios rotulados "
             f"(representando {res['total_pond']:.0f} do universo)\n")

    L.append(f"  {'classe':<10} {'precisao':>20} {'revocacao':>10} {'F1':>7} {'n':>5}")
    for c in CLASSES:
        m = res["por_classe"][c]
        ic = f"[{m['precisao_ic'][0]:.0f}-{m['precisao_ic'][1]:.0f}]"
        L.append(f"  {c:<10} {m['precisao']:>7.1f}% {ic:>11} "
                 f"{m['revocacao']:>9.1f}% {m['f1']:>6.1f} {m['n_amostra']:>5}")

    L.append(f"\n  Acuracia geral (ponderada): {res['acuracia']:.1f}%")
    L.append(f"  Kappa de Cohen           : {res['kappa']:.3f}  ({_leitura_kappa(res['kappa'])})")

    L.append("\n  MATRIZ DE CONFUSAO (ponderada para o universo)")
    L.append(f"  {'previsto \\ real':<18}" + "".join(f"{c:>12}" for c in CLASSES))
    for prev in CLASSES:
        linha = "".join(f"{res['matriz'][prev][verd]:>12.0f}" for verd in CLASSES)
        L.append(f"  {prev:<18}{linha}")
    return "\n".join(L)


def _leitura_kappa(k):
    """Escala de Landis e Koch, a referência usual para concordancia."""
    if k < 0:    return "pior que o acaso"
    if k < 0.20: return "leve"
    if k < 0.40: return "razoavel"
    if k < 0.60: return "moderada"
    if k < 0.80: return "substancial"
    return "quase perfeita"


# ==============================================================
# 3. PLANILHA DE ROTULAGEM (HTML local, cego)
# ==============================================================

GUIA_ROTULAGEM = [
    ("O que voce esta medindo",
     "O sentimento que o CIDADAO EXPRESSOU sobre a atual gestao municipal de "
     "Alagoinhas: prefeito Gustavo Carmo, prefeitura, secretarias, obras, "
     "programas e servicos publicos. Voce le a opiniao que a pessoa escreveu, "
     "nao deduz o que ela significaria politicamente."),
    ("Passo 1, o portao",
     "Pergunte primeiro: este comentario avalia a GESTAO MUNICIPAL? So passa "
     "quem cita ou implica o prefeito, a prefeitura, a gestao, uma secretaria, "
     "uma obra, um programa municipal ou a qualidade de um servico publico. "
     "Se nao passar, e NEUTRO, e nenhuma regra abaixo muda isso."),
    ("Passo 2, a polaridade",
     "POSITIVO: o cidadao aprovou algo da gestao. NEGATIVO: o cidadao reprovou "
     "algo da gestao. NEUTRO: passou no portao mas nao tem juizo de valor "
     "(pergunta factual, informacao, comentario descritivo)."),
    ("Apoio a opositor nao e critica",
     "Elogiar vereador ou politico de oposicao ('parabens vereador', 'voce e o "
     "proximo prefeito') e opiniao sobre AQUELA PESSOA: NEUTRO. So vira "
     "NEGATIVO se o comentario tambem reprovar a gestao."),
    ("Risada nao e prova de ironia",
     "Risada aparece em deboche, mas tambem em concordancia e no riso de quem "
     "DEFENDE a gestao. Para marcar ironia e preciso a contradicao no proprio "
     "texto. Na duvida entre ironia e elogio sincero, use 'nao sei'."),
    ("Cobranca so e negativa com reprovacao",
     "Pedido ou pergunta sem reclamacao e NEUTRO. E NEGATIVO quando a cobranca "
     "carrega insatisfacao: promessa nao cumprida, abandono, demora."),
    ("Outro municipio",
     "Se a publicacao trata da gestao de outra cidade, todo comentario sobre "
     "aquele prefeito ou aquela obra e NEUTRO aqui, inclusive elogio e deboche."),
    ("Quando usar 'nao sei'",
     "Use sem culpa quando o texto for curto demais, ambiguo ou depender de um "
     "contexto que voce nao tem. Esses casos saem da conta em vez de virar "
     "ruido. Chutar para nao deixar em branco estraga a medicao."),
]


def gerar_html_rotulagem(amostra, titulo="Rotulagem de sentimento"):
    """Gera a planilha de rotulagem: HTML local, autocontido, CEGO.

    Nao mostra o rotulo do modelo em lugar nenhum, nem no HTML nem no DOM: o
    gabarito vive noutro arquivo. Rotulador que ve o palpite da maquina
    concorda com ela por ancoragem.

    Deliberadamente um arquivo LOCAL, nunca publicado: a amostra contem texto e
    @ de cidadaos reais, que e exatamente o dado que a politica de retencao
    (migration 009) existe para proteger.
    """
    itens = []
    for i, c in enumerate(amostra):
        ctx = html.escape(f"@{c.get('autor_post','')} ({c.get('categoria_post','')})")
        cap = html.escape((c.get("caption_post") or "")[:140])
        itens.append({
            "id": str(c.get("id", "")),
            "texto": html.escape(c.get("texto", "")),
            "ctx": ctx,
            "cap": cap,
            "i": i,
        })

    guia = "".join(
        f"<details><summary>{html.escape(t)}</summary><p>{html.escape(d)}</p></details>"
        for t, d in GUIA_ROTULAGEM
    )

    cards = "".join(
        f'<article class="c" data-id="{it["id"]}" data-i="{it["i"]}">'
        f'<header><span class="n">{it["i"]+1}</span>'
        f'<span class="ctx">{it["ctx"]}</span></header>'
        + (f'<p class="cap">Post: {it["cap"]}</p>' if it["cap"] else "")
        + f'<blockquote>{it["texto"]}</blockquote>'
        f'<div class="btns">'
        f'<button data-v="positivo">Positivo <kbd>1</kbd></button>'
        f'<button data-v="negativo">Negativo <kbd>2</kbd></button>'
        f'<button data-v="neutro">Neutro <kbd>3</kbd></button>'
        f'<button data-v="naosei" class="ns">Nao sei <kbd>0</kbd></button>'
        f'</div></article>'
        for it in itens
    )

    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(titulo)}</title>
<style>
 :root{{--bg:#EEF1F4;--sf:#fff;--ink:#1B2733;--mut:#64757F;--ln:#C6D0D8;
       --pos:#2F6B4F;--neg:#A33A2A;--neu:#5B6B78;--ac:#1F5F7A}}
 @media(prefers-color-scheme:dark){{:root{{--bg:#131C24;--sf:#1B252E;--ink:#DEE6EB;
       --mut:#8397A3;--ln:#2D3B47;--pos:#7CBB99;--neg:#DE8873;--neu:#93A5B1;--ac:#6BAECA}}}}
 *{{box-sizing:border-box}}
 body{{margin:0;background:var(--bg);color:var(--ink);
      font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}}
 .wrap{{max-width:800px;margin:0 auto;padding:24px 18px 140px}}
 h1{{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}}
 .sub{{color:var(--mut);margin:0 0 22px}}
 details{{background:var(--sf);border:1px solid var(--ln);border-radius:6px;
          padding:10px 14px;margin-bottom:6px}}
 summary{{cursor:pointer;font-weight:600;font-size:14.5px}}
 details p{{margin:10px 0 2px;font-size:14.5px;color:var(--mut)}}
 .c{{background:var(--sf);border:1px solid var(--ln);border-radius:8px;
     padding:18px 20px;margin:14px 0;scroll-margin-top:16px}}
 .c.done{{opacity:.5}}
 .c.atual{{border-color:var(--ac);box-shadow:0 0 0 2px color-mix(in srgb,var(--ac) 30%,transparent)}}
 .c header{{display:flex;gap:10px;align-items:center;font-size:12.5px;color:var(--mut);
            text-transform:uppercase;letter-spacing:.08em}}
 .n{{font-weight:700;color:var(--ac)}}
 .cap{{font-size:13.5px;color:var(--mut);margin:8px 0 0;font-style:italic}}
 blockquote{{margin:12px 0 16px;font-size:18px;line-height:1.5;white-space:pre-wrap;
             word-break:break-word}}
 .btns{{display:flex;gap:8px;flex-wrap:wrap}}
 button{{flex:1;min-width:120px;padding:10px 12px;border-radius:6px;cursor:pointer;
         border:1.5px solid var(--ln);background:transparent;color:var(--ink);
         font:inherit;font-size:14.5px;font-weight:600}}
 button:hover{{border-color:var(--ac)}}
 button[data-v=positivo].on{{background:var(--pos);border-color:var(--pos);color:#fff}}
 button[data-v=negativo].on{{background:var(--neg);border-color:var(--neg);color:#fff}}
 button[data-v=neutro].on{{background:var(--neu);border-color:var(--neu);color:#fff}}
 button[data-v=naosei].on{{background:var(--mut);border-color:var(--mut);color:#fff}}
 kbd{{font:inherit;font-size:11px;opacity:.55;border:1px solid currentColor;
      border-radius:3px;padding:0 4px;margin-left:4px}}
 .bar{{position:fixed;left:0;right:0;bottom:0;background:var(--sf);
       border-top:1px solid var(--ln);padding:12px 18px;display:flex;gap:14px;
       align-items:center;justify-content:center;flex-wrap:wrap}}
 .bar b{{font-variant-numeric:tabular-nums}}
 .bar button{{flex:none;min-width:auto;padding:9px 18px;background:var(--ac);
              border-color:var(--ac);color:#fff}}
 .prog{{height:5px;background:var(--ln);border-radius:3px;width:190px;overflow:hidden}}
 .prog i{{display:block;height:100%;background:var(--ac);width:0}}
</style></head><body><div class="wrap">
<h1>{html.escape(titulo)}</h1>
<p class="sub">Leia cada comentario e diga o que <b>o cidadao expressou sobre a
gestao municipal</b>. Atalhos: <b>1</b> positivo, <b>2</b> negativo,
<b>3</b> neutro, <b>0</b> nao sei. O progresso fica salvo no navegador.</p>
<div style="margin-bottom:20px">{guia}</div>
{cards}
</div>
<div class="bar">
  <div class="prog"><i id="pi"></i></div>
  <span><b id="feito">0</b> de <b>{len(itens)}</b></span>
  <button id="exp">Exportar CSV</button>
</div>
<script>
const CH="rotulagem_radar";
let R=JSON.parse(localStorage.getItem(CH)||"{{}}");
const cards=[...document.querySelectorAll(".c")];
function pinta(){{
  let n=0;
  for(const c of cards){{
    const v=R[c.dataset.id];
    c.querySelectorAll(".btns button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
    c.classList.toggle("done",!!v);
    if(v)n++;
  }}
  document.getElementById("feito").textContent=n;
  document.getElementById("pi").style.width=(n/cards.length*100)+"%";
}}
function marca(card,v){{
  R[card.dataset.id]=v; localStorage.setItem(CH,JSON.stringify(R)); pinta();
  const prox=cards[cards.indexOf(card)+1];
  if(prox){{foca(prox); prox.scrollIntoView({{behavior:"smooth",block:"center"}});}}
}}
let atual=cards[0];
function foca(c){{cards.forEach(x=>x.classList.remove("atual"));atual=c;c.classList.add("atual");}}
document.addEventListener("click",e=>{{
  const b=e.target.closest(".btns button"); if(!b)return;
  const c=b.closest(".c"); foca(c); marca(c,b.dataset.v);
}});
document.addEventListener("keydown",e=>{{
  const m={{"1":"positivo","2":"negativo","3":"neutro","0":"naosei"}};
  if(m[e.key]&&atual){{e.preventDefault();marca(atual,m[e.key]);}}
}});
document.getElementById("exp").addEventListener("click",()=>{{
  let csv="id,rotulo_humano\\n";
  for(const c of cards){{const v=R[c.dataset.id]; if(v)csv+=c.dataset.id+","+v+"\\n";}}
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{{type:"text/csv;charset=utf-8"}}));
  a.download="rotulos.csv"; a.click();
}});
if(cards.length)foca(cards[0]);
pinta();
</script></body></html>"""


def ler_rotulos_csv(caminho):
    """Le o CSV exportado pela planilha: id,rotulo_humano."""
    rotulos = {}
    with open(caminho, encoding="utf-8-sig", newline="") as f:
        for linha in csv.DictReader(f):
            rid = (linha.get("id") or "").strip()
            val = (linha.get("rotulo_humano") or "").strip().lower()
            if rid and val in CLASSES:  # "naosei" cai fora da conta de propósito
                rotulos[rid] = val
    return rotulos


# ==============================================================
# TESTES
# ==============================================================

if __name__ == "__main__":
    # Universo sintético desbalanceado como o real (47/42/11).
    universo = (
        [{"id": f"n{i}", "texto": "x", "sentimento": "negativo"} for i in range(1054)]
        + [{"id": f"u{i}", "texto": "x", "sentimento": "neutro"} for i in range(950)]
        + [{"id": f"p{i}", "texto": "x", "sentimento": "positivo"} for i in range(243)]
    )
    amostra, estratos = montar_amostra(universo, por_estrato=100)
    assert len(amostra) == 300, len(amostra)
    assert estratos["negativo"] == {"N": 1054, "n": 100, "N_conf": 0}
    assert estratos["positivo"] == {"N": 243, "n": 100, "N_conf": 0}
    # Reprodutibilidade: mesma semente devolve a mesma amostra.
    a2, _ = montar_amostra(universo, por_estrato=100)
    assert [c["id"] for c in amostra] == [c["id"] for c in a2]
    # Comentário sem texto (já expurgado) não pode entrar na amostra.
    sem_texto = [{"id": "z", "texto": "", "sentimento": "negativo"}]
    assert montar_amostra(sem_texto)[1]["negativo"]["N"] == 0

    # Classificador perfeito -> 100% e kappa 1.
    pares = ([{"previsto": c, "verdadeiro": c, "confianca": 90}] * 100 for c in CLASSES)
    perfeito = [p for grupo in pares for p in grupo]
    r = calcular_metricas(perfeito, estratos)
    assert round(r["acuracia"], 6) == 100.0, r["acuracia"]
    assert round(r["kappa"], 6) == 1.0

    # A PONDERAÇÃO IMPORTA: modelo que acerta todo negativo e erra todo positivo
    # deve ficar perto de 89% (positivo é só 10,8% do universo), não de 66,7%,
    # que é o que uma média simples dos estratos daria.
    viesado = (
        [{"previsto": "negativo", "verdadeiro": "negativo", "confianca": 90}] * 100
        + [{"previsto": "neutro", "verdadeiro": "neutro", "confianca": 90}] * 100
        + [{"previsto": "positivo", "verdadeiro": "neutro", "confianca": 90}] * 100
    )
    r2 = calcular_metricas(viesado, estratos)
    assert 88.0 < r2["acuracia"] < 90.0, r2["acuracia"]
    assert r2["por_classe"]["positivo"]["precisao"] == 0.0
    assert r2["por_classe"]["negativo"]["precisao"] == 100.0
    media_simples = sum(r2["por_classe"][c]["precisao"] for c in CLASSES) / 3
    assert abs(media_simples - 66.67) < 0.1, "media simples seria 66,7%: a ponderacao muda o numero"

    # Corte de confiança tira da conta quem o modelo declarou não saber.
    misto = (
        [{"previsto": "negativo", "verdadeiro": "negativo", "confianca": 90}] * 50
        + [{"previsto": "negativo", "verdadeiro": "positivo", "confianca": 10}] * 50
    )
    est1 = {"negativo": {"N": 1054, "n": 100, "N_conf": 500},
            "neutro": {"N": 0, "n": 0, "N_conf": 0},
            "positivo": {"N": 0, "n": 0, "N_conf": 0}}
    assert calcular_metricas(misto, est1)["acuracia"] == 50.0
    assert calcular_metricas(misto, est1, so_confiantes=True)["acuracia"] == 100.0

    # O universo do bloco restrito tem que ser o dos CONFIANTES, nao o cheio.
    # Se voltar a usar o N cheio, a subamostra confiante fica extrapolada para
    # uma populacao maior do que representa e o numero infla.
    r_conf = calcular_metricas(misto, est1, so_confiantes=True)
    assert round(r_conf["total_pond"]) == 500, r_conf["total_pond"]
    assert round(calcular_metricas(misto, est1)["total_pond"]) == 1054

    # N_conf sai da amostragem contando o universo, nao a amostra.
    univ_conf = ([{"id": f"a{i}", "texto": "x", "sentimento": "negativo",
                   "confianca_tema": 90} for i in range(80)]
                 + [{"id": f"b{i}", "texto": "x", "sentimento": "negativo",
                     "confianca_tema": 10} for i in range(20)])
    _, est_conf = montar_amostra(univ_conf, por_estrato=10)
    assert est_conf["negativo"] == {"N": 100, "n": 10, "N_conf": 80}, est_conf["negativo"]

    # Wilson não estoura acima de 100% mesmo com acerto total.
    assert _wilson(100, 100)[1] <= 100.0
    assert _wilson(0, 0) == (0.0, 0.0)

    # HTML é CEGO. O teste certo não é procurar a palavra "negativo" no
    # documento: ela aparece de qualquer jeito no botão e no mapa de teclas,
    # que são vocabulário da interface e não gabarito. A propriedade que
    # importa é outra: dois comentários idênticos no texto e diferentes APENAS
    # no rótulo do modelo têm que gerar cartões indistinguíveis. Se em algum
    # momento alguém adicionar um data-attribute com a predição, isto quebra.
    import re as _re
    base = {"texto": "prefeitura abandonou minha rua", "autor_post": "x",
            "categoria_post": "Imprensa"}
    doc_a = gerar_html_rotulagem([{**base, "id": "MESMO", "sentimento": "negativo"}])
    doc_b = gerar_html_rotulagem([{**base, "id": "MESMO", "sentimento": "positivo"}])
    card = lambda d: _re.search(r'<article class="c".*?</article>', d, _re.S).group(0)
    assert card(doc_a) == card(doc_b), "o rotulo do modelo vazou para o cartao"
    assert "prefeitura abandonou" in card(doc_a)
    assert "sentimento" not in card(doc_a)

    print("acuracia.py: todas as assercoes passaram")
    print(formatar_relatorio(calcular_metricas(viesado, estratos)))
