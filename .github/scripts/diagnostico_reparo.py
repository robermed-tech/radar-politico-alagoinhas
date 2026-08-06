# -*- coding: utf-8 -*-
"""Sonda das camadas do reparo de acentos, com veredito legível de fora.

O primeiro run do reparo (06/08) saiu VERDE com efeito zero: cada linha degrada
em log ("erro na correcao — linha mantida"), e os logs do Actions não são
legíveis sem token de autenticação. Este script testa uma camada por vez (o
mesmo desenho do `alerta_suporte.py --diagnostico`: para na primeira que falha
e diz de quem é o problema) e, além de imprimir, abre/atualiza UMA issue com o
veredito — issues de repositório público são legíveis pela API sem token, então
o diagnóstico chega a quem não consegue abrir o log do job.

Nunca imprime chave nem texto de briefing; o corpo de erro da Anthropic não
contém segredo.
"""
import json
import os
import sys
import urllib.error
import urllib.request

def _http(url, headers=None, data=None, method="GET"):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # rede fora, DNS etc.
        return 0, str(e)

veredito = []
falhou = False

# 1) Anthropic: uma chamada mínima. O corpo do erro distingue crédito esgotado,
#    chave inválida e instabilidade — a informação que faltou no primeiro run.
#    Vira AVISO, não falha: desde 06/08 o passo do mapa determinístico
#    (acentuar_textos.py) corrige os textos SEM modelo, então crédito
#    esgotado não impede o objetivo — o job só falha se restar briefing sem
#    acento ou o Supabase estiver fora.
chave = os.environ.get("ANTHROPIC_API_KEY", "")
if not chave:
    veredito.append("AVISO Anthropic: ANTHROPIC_API_KEY ausente no ambiente do job")
else:
    st, corpo = _http(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": chave,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        data=json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 8,
            "messages": [{"role": "user", "content": "ok"}],
        }).encode(),
        method="POST",
    )
    if st == 200:
        veredito.append("Anthropic: OK (sonda respondeu 200)")
    else:
        veredito.append(f"AVISO Anthropic: HTTP {st} — {corpo[:300]}")

# 2) Supabase (service key): GET + quantas linhas seguem sem NENHUM acento num
#    diagnóstico longo — um texto real de briefing sem acento nenhum é o
#    sintoma que motivou o reparo.
url = os.environ.get("SUPABASE_URL", "").rstrip("/")
skey = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not url or not skey:
    veredito.append("SUPABASE_URL/SUPABASE_SERVICE_KEY: AUSENTES no ambiente do job")
    falhou = True
else:
    st, corpo = _http(
        f"{url}/rest/v1/ai_briefings?tenant=eq.alagoinhas&select=dia,periodo,diagnostico",
        headers={"apikey": skey, "Authorization": f"Bearer {skey}"},
    )
    if st != 200:
        falhou = True
        veredito.append(f"Supabase GET: FALHA HTTP {st} — {corpo[:200]}")
    else:
        rows = json.loads(corpo)
        acentos = "áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ"
        sem = [
            r for r in rows
            if len(r.get("diagnostico") or "") > 120
            and not any(ch in acentos for ch in r["diagnostico"])
        ]
        veredito.append(
            f"Supabase GET: OK — {len(rows)} briefings, "
            f"{len(sem)} com diagnóstico longo sem nenhum acento"
        )
        if sem:
            falhou = True
            veredito.append(
                "Ainda sem acento: "
                + ", ".join(f"{r['periodo']}/{r['dia']}" for r in sem[:8])
            )

    # 2b) posts (Feed "O que o povo diz") — mesma checagem, outra tabela: o
    #     defeito de acentuação atingiu as duas e a sonda tem que enxergar as
    #     duas, senão o job fica verde com metade do trabalho feito.
    st, corpo = _http(
        f"{url}/rest/v1/posts?tenant=eq.alagoinhas"
        "&select=url,resumo,queixa_dominante,elogio_dominante&limit=5000",
        headers={"apikey": skey, "Authorization": f"Bearer {skey}"},
    )
    if st != 200:
        falhou = True
        veredito.append(f"Supabase GET posts: FALHA HTTP {st} — {corpo[:200]}")
    else:
        linhas = json.loads(corpo)
        acentos = "áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ"
        n = sum(
            1
            for p in linhas
            for c in ("resumo", "queixa_dominante", "elogio_dominante")
            if isinstance(p.get(c), str) and len(p[c].strip()) > 20
            and not any(ch in acentos for ch in p[c])
        )
        veredito.append(f"Supabase posts: OK — {len(linhas)} posts, {n} texto(s) sem nenhum acento")
        if n:
            falhou = True

print("\n".join(veredito))

# 3) Issue única com o veredito (rótulo reparo-acentos). Reaproveita a aberta
#    em vez de criar uma por run — a regra do canal de reserva do
#    alerta_suporte — e FECHA quando tudo passa, para não sobrar issue morta.
tok = os.environ.get("GITHUB_TOKEN", "")
repo = os.environ.get("GITHUB_REPOSITORY", "")
if tok and repo:
    gh = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"}
    titulo = "Reparo de acentos: diagnóstico do último run"
    st, corpo = _http(
        f"https://api.github.com/repos/{repo}/issues?state=open&labels=reparo-acentos",
        headers=gh,
    )
    abertas = json.loads(corpo) if st == 200 else []
    existente = next((i for i in abertas if i.get("title") == titulo), None)
    corpo_md = (
        f"Veredito automático do workflow reparo-acentos "
        f"(run {os.environ.get('GITHUB_RUN_ID', '?')}):\n\n"
        "```\n" + "\n".join(veredito) + "\n```\n"
    )
    payload = {"title": titulo, "body": corpo_md, "labels": ["reparo-acentos"]}
    if not falhou:
        payload["state"] = "closed"
    if existente:
        _http(existente["url"], headers=gh, data=json.dumps(payload).encode(), method="PATCH")
    elif falhou:
        _http(f"https://api.github.com/repos/{repo}/issues", headers=gh,
              data=json.dumps(payload).encode(), method="POST")

sys.exit(1 if falhou else 0)
