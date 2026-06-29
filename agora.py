"""
+==============================================================+
|  AGORA - Agente de Monitoramento Politico                     |
|  Radar Politico Alagoinhas                                    |
|                                                               |
|  Pipeline:                                                    |
|    Apify -> Comentarios -> Memoria -> Claude Haiku             |
|    -> Sheets -> WhatsApp                                      |
|                                                               |
|  Execucao: GitHub Actions 4x/dia                              |
|  Autor: Roberio / robermed-tech                               |
+==============================================================+
"""

import os
import re
import json
import time
import math
import requests
from datetime import datetime, timedelta
from anthropic import Anthropic
import gspread
from google.oauth2.service_account import Credentials
from boletim import gerar_boletim

try:
    import coletor_instagram as _ig
    _INSTAGRAPI_OK = _ig.disponivel()
except Exception:
    _INSTAGRAPI_OK = False

# ==============================================================
# CONFIGURACAO
# ==============================================================

APIFY_TOKEN      = os.environ.get("APIFY_API_TOKEN", "")
ANTHROPIC_KEY    = os.environ["ANTHROPIC_API_KEY"]
SPREADSHEET_ID   = os.environ["SPREADSHEET_ID"]
EVOLUTION_URL    = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_KEY    = os.environ.get("EVOLUTION_API_KEY", "")
WHATSAPP_NUMBER  = os.environ.get("WHATSAPP_NUMBER", "")
# Supabase (Fase 2 — dual-write). Se vazio, o dual-write é ignorado (Sheets segue normal).
SUPABASE_URL     = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY     = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT           = os.environ.get("RADAR_TENANT", "alagoinhas")
# Multi-agente: modelo do Caçador de Crises. Default = Haiku (garante funcionamento).
# Para mais raciocínio, defina CRISIS_MODEL=claude-sonnet-... como secret/env.
MODELO_ANALISTA  = "claude-haiku-4-5-20251001"     # triagem rápida (todos os posts)
MODELO_PROFUNDO  = os.environ.get("ANALISTA_PROFUNDO_MODEL", "claude-sonnet-4-6")  # análise completa (posts de risco)
LIMIAR_TRIAGEM   = int(os.environ.get("LIMIAR_TRIAGEM", "45"))  # score_risco ≥ esse valor → análise profunda
CRISIS_MODEL     = os.environ.get("CRISIS_MODEL", MODELO_PROFUNDO)  # Caçador de Crises usa Sonnet por padrão
MAX_CRISES_RUN   = 3   # teto de chamadas do Caçador por execução (controle de custo)

APIFY_BASE = "https://api.apify.com/v2"

# Actor IDs (nomes oficiais do Apify Store)
ACTOR_POSTS    = "apify~instagram-post-scraper"
ACTOR_COMMENTS = "apify~instagram-comment-scraper"

# Perfis monitorados — fallback hardcoded (usado se monitored_sources estiver vazio)
_PERFIS_FALLBACK = {
    # Governo
    "gustavoascarmo":       {"categoria": "Prefeito",    "filtro": "governo"},
    "prefeituraalagoinhas": {"categoria": "Prefeitura",  "filtro": "governo"},
    # Oposicao
    "soulucianoalmeida":    {"categoria": "Oposicao",    "filtro": "oposicao"},
    "oficialjoaquimneto":   {"categoria": "Oposicao",    "filtro": "oposicao"},
    "paulocezar_oficial":   {"categoria": "Oposicao",    "filtro": "oposicao"},
    "jaldicenunes":         {"categoria": "Oposicao",    "filtro": "oposicao"},
    "eulumamenezes":        {"categoria": "Oposicao",    "filtro": "oposicao"},
    "gleysersoares":        {"categoria": "Oposicao",    "filtro": "oposicao"},
    # Imprensa
    "seligaalagoinhas":     {"categoria": "Imprensa",    "filtro": "imprensa"},
    "portalalagoinhasnews": {"categoria": "Imprensa",    "filtro": "imprensa"},
    "jornalalagoinhas":     {"categoria": "Imprensa",    "filtro": "imprensa"},
    "suacidade":            {"categoria": "Imprensa",    "filtro": "imprensa"},
    "alagoinhas24h":        {"categoria": "Imprensa",    "filtro": "imprensa"},
    "alagonews":            {"categoria": "Imprensa",    "filtro": "imprensa"},
}

def _carregar_perfis_do_banco():
    """Carrega fontes ativas de monitored_sources. Fallback para _PERFIS_FALLBACK."""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        return _PERFIS_FALLBACK
    try:
        r = requests.get(
            f"{url}/rest/v1/monitored_sources",
            params={"platform": "eq.instagram", "active": "eq.true",
                    "select": "handle,categoria,filtro"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code != 200:
            return _PERFIS_FALLBACK
        rows = r.json()
        if not rows:
            return _PERFIS_FALLBACK
        perfis = {}
        for row in rows:
            handle = row["handle"].lstrip("@").lower()
            # Usa categoria/filtro do banco se presentes; senão tenta fallback; senão default
            fallback = _PERFIS_FALLBACK.get(handle, {"categoria": "Monitorado", "filtro": "governo"})
            perfis[handle] = {
                "categoria": row.get("categoria") or fallback["categoria"],
                "filtro":    row.get("filtro")    or fallback["filtro"],
            }
        return perfis
    except Exception:
        return _PERFIS_FALLBACK

PERFIS = _carregar_perfis_do_banco()

# Palavras-chave de relevancia por filtro
_KEYWORDS_FALLBACK_GOVERNO  = ["prefeitura", "prefeito", "gustavo", "gestao", "alagoinhas",
                               "obra", "servico", "municipal", "secretaria", "secom"]
_KEYWORDS_FALLBACK_OPOSICAO = ["prefeitura", "prefeito", "gustavo carmo", "gestao municipal",
                               "alagoinhas", "administracao"]
_KEYWORDS_FALLBACK_IMPRENSA = ["prefeitura de alagoinhas", "gustavo carmo", "gestao municipal",
                               "prefeito de alagoinhas"]

def _carregar_keywords_do_banco():
    """Busca keywords ativas de relevance_keywords (lista única para todos os filtros).
    Fallback por categoria se o banco estiver vazio ou inacessível."""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        return None
    try:
        r = requests.get(
            f"{url}/rest/v1/relevance_keywords",
            params={"tenant_id": "eq.alagoinhas", "active": "eq.true", "select": "keyword"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return None
        return [row["keyword"].lower() for row in r.json()]
    except Exception:
        return None

_keywords_banco = _carregar_keywords_do_banco()
# Se o banco retornou keywords, todas as categorias usam a mesma lista.
# Caso contrário, cada categoria usa seu fallback específico.
KEYWORDS_GOVERNO  = _keywords_banco or _KEYWORDS_FALLBACK_GOVERNO
KEYWORDS_OPOSICAO = _keywords_banco or _KEYWORDS_FALLBACK_OPOSICAO
KEYWORDS_IMPRENSA = _keywords_banco or _KEYWORDS_FALLBACK_IMPRENSA

if _keywords_banco:
    print(f"[keywords] Supabase: {len(_keywords_banco)} keywords carregadas → {_keywords_banco}")
else:
    print(f"[keywords] Fallback hardcoded — governo:{len(KEYWORDS_GOVERNO)} oposicao:{len(KEYWORDS_OPOSICAO)} imprensa:{len(KEYWORDS_IMPRENSA)}")

# Score de alerta
SCORE_IMAGEM_ALERTA = 30
SCORE_RISCO_ALERTA  = 70

# Override SCCT criterioso — alerta crises intencionais de alta responsabilidade
# mesmo quando o score nao atinge 70 (posts de oposicao eficazes ficam em ~62).
# Ajuste estes 4 valores para calibrar (veja GUIA_CALIBRACAO_ALERTAS.md):
OVERRIDE_ALERTA_ATIVO         = True   # False volta ao comportamento antigo
OVERRIDE_RESPONSABILIDADE_MIN = 70     # responsabilidade_atribuida minima
OVERRIDE_SCORE_MIN            = 55     # piso de score (abaixo disso, ignora)
OVERRIDE_EXIGE_TRACAO         = True   # exige tendencia crescendo OU engajamento alto

# Limites de coleta
MAX_POSTS_POR_PERFIL    = 5
MAX_COMENTARIOS_POR_POST = 50
DIAS_RETROATIVOS        = 3

# ==============================================================
# MODULO 0 - UTILITARIOS
# ==============================================================

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")

def _safe(nome, fn, *args, **kwargs):
    """Executa uma etapa secundaria isolando falhas: loga e segue. Garante que
    o pipeline (em especial os alertas, que rodam por ultimo) nao seja derrubado
    por uma unica etapa que estoure (Supabase fora, erro de schema, etc.)."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        log(f"  [etapa '{nome}' FALHOU] {e} — seguindo")
        return None

def timestamp_para_data(ts):
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts).strftime("%d/%m/%Y")
        if isinstance(ts, str):
            for fmt in ["%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
                        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"]:
                try:
                    return datetime.strptime(ts[:26], fmt).strftime("%d/%m/%Y")
                except ValueError:
                    continue
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y")
    except Exception:
        pass
    return datetime.now().strftime("%d/%m/%Y")

def extrair(obj, *chaves, padrao=""):
    for chave in chaves:
        if chave in obj and obj[chave] is not None:
            return obj[chave]
    return padrao

def extrair_caption(caption_raw):
    if isinstance(caption_raw, dict):
        return caption_raw.get("text", "")
    return str(caption_raw) if caption_raw else ""

def dentro_do_periodo(data_str, dias=DIAS_RETROATIVOS):
    try:
        partes = data_str.split("/")
        dt = datetime(int(partes[2]), int(partes[1]), int(partes[0]))
        return dt >= datetime.now() - timedelta(days=dias)
    except Exception:
        return True

def filtrar_relevante(caption, categoria_filtro):
    texto = caption.lower()
    if categoria_filtro == "governo":
        return any(kw in texto for kw in KEYWORDS_GOVERNO)
    if categoria_filtro == "oposicao":
        return any(kw in texto for kw in KEYWORDS_OPOSICAO)
    if categoria_filtro == "imprensa":
        return any(kw in texto for kw in KEYWORDS_IMPRENSA)
    return True

def conectar_sheets():
    creds_json = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not creds_json:
        raise ValueError("GOOGLE_CREDENTIALS nao configurado")
    creds_dict = json.loads(creds_json)
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds  = Credentials.from_service_account_info(creds_dict, scopes=scopes)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID)

def garantir_aba(planilha, nome, cabecalho):
    try:
        aba = planilha.worksheet(nome)
        return aba
    except gspread.exceptions.WorksheetNotFound:
        aba = planilha.add_worksheet(title=nome, rows=5000, cols=len(cabecalho))
        aba.append_row(cabecalho)
        log(f"  Aba '{nome}' criada")
        return aba

# ==============================================================
# APIFY - FUNCOES AUXILIARES
# ==============================================================

def apify_iniciar_run(actor_id, input_data, memory_mbytes=256):
    """Inicia um actor run no Apify e retorna o run ID."""
    url = f"{APIFY_BASE}/acts/{actor_id}/runs"
    params = {"token": APIFY_TOKEN}
    body = {
        "memory": memory_mbytes,
        **input_data
    }
    r = requests.post(url, params=params, json=body, timeout=30)
    if r.status_code not in (200, 201):
        log(f"    Erro ao iniciar actor {actor_id}: {r.status_code} | {r.text[:200]}")
        return None
    data = r.json().get("data", {})
    run_id = data.get("id")
    log(f"    Run iniciado: {run_id}")
    return run_id

def apify_aguardar_run(run_id, timeout=300):
    """Aguarda um run do Apify terminar. Retorna o dataset ID."""
    url = f"{APIFY_BASE}/actor-runs/{run_id}"
    params = {"token": APIFY_TOKEN}
    inicio = time.time()
    while time.time() - inicio < timeout:
        r = requests.get(url, params=params, timeout=15)
        if r.status_code != 200:
            time.sleep(5)
            continue
        data = r.json().get("data", {})
        status = data.get("status", "")
        if status == "SUCCEEDED":
            dataset_id = data.get("defaultDatasetId")
            log(f"    Run concluido | Dataset: {dataset_id}")
            return dataset_id
        if status in ("FAILED", "ABORTED", "TIMED-OUT"):
            log(f"    Run falhou: {status}")
            return None
        time.sleep(10)
    log(f"    Timeout aguardando run {run_id}")
    return None

def apify_buscar_resultados(dataset_id, limit=500):
    """Busca os itens de um dataset do Apify."""
    url = f"{APIFY_BASE}/datasets/{dataset_id}/items"
    params = {"token": APIFY_TOKEN, "limit": limit, "format": "json"}
    r = requests.get(url, params=params, timeout=30)
    if r.status_code != 200:
        log(f"    Erro ao buscar dataset: {r.status_code}")
        return []
    return r.json()

def verificar_creditos_apify():
    """Verifica uso de créditos Apify e dispara alerta WhatsApp se > 80% consumido."""
    if not APIFY_TOKEN:
        return
    try:
        r = requests.get(
            f"{APIFY_BASE}/users/me",
            params={"token": APIFY_TOKEN},
            timeout=10,
        )
        if r.status_code != 200:
            log(f"  Apify credits: HTTP {r.status_code} — ignorando")
            return
        data = r.json().get("data", {})
        uso = data.get("monthlyUsage", {}).get("totalUsd", 0) or 0
        teto = (data.get("plan", {}).get("maxMonthlyUsageUsd") or
                data.get("plan", {}).get("monthlyUsageCycleCap") or 0)
        if not teto:
            log(f"  Apify credits: uso ${uso:.2f} (teto não identificado no plano)")
            return
        pct = (uso / teto) * 100
        log(f"  Apify credits: ${uso:.2f} / ${teto:.2f} ({pct:.0f}%)")
        if pct >= 80 and EVOLUTION_URL and EVOLUTION_KEY and WHATSAPP_NUMBER:
            restante = teto - uso
            msg = (
                f"⚠️ *RADAR — Créditos Apify em {pct:.0f}%*\n"
                f"Consumido: ${uso:.2f} de ${teto:.2f}\n"
                f"Restante: ${restante:.2f}\n"
                f"Acesse apify.com/billing para recarregar antes que a coleta pare."
            )
            requests.post(
                f"{EVOLUTION_URL}/message/sendText/{os.environ.get('EVOLUTION_INSTANCE','radar')}",
                headers={"Content-Type": "application/json", "apikey": EVOLUTION_KEY},
                json={"number": WHATSAPP_NUMBER, "text": msg},
                timeout=15,
            )
            log(f"  Alerta de créditos enviado via WhatsApp")
    except Exception as e:
        log(f"  Apify credits: erro ao verificar ({e})")

# ==============================================================
# MODULO 1 - COLETA DE POSTS VIA APIFY
# ==============================================================

def _normalizar_posts(resultados_brutos):
    """Normaliza posts brutos (Apify ou Instagrapi) para o formato interno."""
    todos_posts = []
    _debug_count = 0
    for p in resultados_brutos:
        handle = extrair(p, "ownerUsername", "username", "owner", padrao="").lower()
        if handle not in PERFIS:
            continue

        info      = PERFIS[handle]
        categoria = info["categoria"]
        filtro    = info["filtro"]

        url = extrair(p, "url", "postUrl", "permalink", "webLink")
        if not url:
            shortcode = extrair(p, "shortCode", "shortcode", "code")
            url = f"https://www.instagram.com/p/{shortcode}/" if shortcode else ""
        if not url:
            continue

        caption   = extrair_caption(extrair(p, "caption", "text", "description"))
        ts_raw    = extrair(p, "timestamp", "taken_at", "takenAt", "date")
        data_post = timestamp_para_data(ts_raw)

        if not dentro_do_periodo(data_post):
            continue

        if _debug_count < 3:
            if filtro == "governo":
                passou = True
                motivo = "governo (sem filtro de relevância)"
            else:
                kw_match = next((kw for kw in (KEYWORDS_OPOSICAO if filtro == "oposicao" else KEYWORDS_IMPRENSA) if kw in caption.lower()), None)
                passou = kw_match is not None
                motivo = f"keyword '{kw_match}' encontrada" if passou else "nenhuma keyword encontrada"
            print(f"[filtro-debug #{_debug_count+1}] @{handle} ({filtro}) | passou={passou} | motivo={motivo}")
            print(f"  caption: {caption[:200]!r}")
            _debug_count += 1

        if filtro != "governo" and not filtrar_relevante(caption, filtro):
            continue

        todos_posts.append({
            "url":           url,
            "autor":         handle,
            "categoria":     categoria,
            "data_post":     data_post,
            "curtidas":      int(extrair(p, "likesCount", "likes", "like_count", padrao=0)),
            "total_coments": int(extrair(p, "commentsCount", "comments", "comment_count", padrao=0)),
            "caption":       caption[:500],
            "shortcode":     extrair(p, "shortCode", "shortcode", "code", padrao=""),
            "_media_pk":     p.get("_media_pk", ""),  # Instagrapi — usado na coleta de comentários
        })
    return todos_posts


def coletar_posts():
    """
    Coleta posts dos perfis monitorados.
    Roda Instagrapi E Apify em sequência e faz merge por URL — nenhuma fonte
    única interrompe o fluxo.
    """
    perfis = list(PERFIS.keys())
    urls_vistos: set = set()
    todos: list = []

    # ── Instagrapi ──────────────────────────────────────────────
    if _INSTAGRAPI_OK:
        log("=== MODULO 1a - Coletando posts via Instagrapi ===")
        try:
            brutos_ig = _ig.coletar_posts(perfis, dias_atras=DIAS_RETROATIVOS)
            log(f"  {len(brutos_ig)} posts brutos (Instagrapi)")
            for p in _normalizar_posts(brutos_ig):
                if p["url"] not in urls_vistos:
                    todos.append(p)
                    urls_vistos.add(p["url"])
        except Exception as e:
            log(f"  Instagrapi falhou: {e}")

    # ── Apify ────────────────────────────────────────────────────
    if APIFY_TOKEN:
        log("=== MODULO 1b - Coletando posts via Apify ===")
        try:
            usernames  = [f"https://www.instagram.com/{h}/" for h in perfis]
            input_data = {"username": usernames, "resultsLimit": MAX_POSTS_POR_PERFIL}
            run_id = apify_iniciar_run(ACTOR_POSTS, input_data)
            if run_id:
                dataset_id = apify_aguardar_run(run_id, timeout=300)
                if dataset_id:
                    brutos_ap = apify_buscar_resultados(dataset_id)
                    log(f"  {len(brutos_ap)} posts brutos (Apify)")
                    novos = 0
                    for p in _normalizar_posts(brutos_ap):
                        if p["url"] not in urls_vistos:
                            todos.append(p)
                            urls_vistos.add(p["url"])
                            novos += 1
                    log(f"  {novos} posts novos adicionados pelo Apify")
        except Exception as e:
            log(f"  Apify falhou: {e}")

    log(f"  Total combinado: {len(todos)} posts relevantes")
    return todos

# ==============================================================
# MODULO 2 - COLETA DE COMENTARIOS VIA APIFY
# ==============================================================

def _normalizar_comentarios(resultados_brutos, posts, posts_com_coments):
    """Normaliza comentários brutos (Apify ou Instagrapi) para o formato interno."""
    handles_monitorados = set(PERFIS.keys())
    resultado = {p["url"]: [] for p in posts}

    for c in resultados_brutos:
        if not isinstance(c, dict):
            continue

        texto = extrair(c, "text", "comment", "content", padrao="").strip()
        if len(texto.split()) < 3:
            continue

        post_url = extrair(c, "postUrl", "inputUrl", "url", padrao="")

        if post_url not in resultado:
            for url_key in resultado:
                if any(sc in url_key for sc in [extrair(c, "shortCode", "postShortCode", padrao="XXX")]):
                    post_url = url_key
                    break

        if post_url not in resultado and posts_com_coments:
            post_url = posts_com_coments[0]["url"]

        username = extrair(c, "ownerUsername", "username", "author", padrao="")
        tipo     = "politico" if username.lower() in handles_monitorados else "cidadao"

        comentario = {
            "id":       str(extrair(c, "id", "pk", padrao="")),
            "texto":    texto[:300],
            "username": username,
            "tipo":     tipo,
            "curtidas": int(extrair(c, "likesCount", "likes", "likeCount", padrao=0)),
            "data":     str(extrair(c, "timestamp", "createdAt", "date", padrao=""))[:10],
        }

        if post_url in resultado:
            resultado[post_url].append(comentario)

    return resultado


def coletar_comentarios(posts):
    """
    Coleta comentários dos posts monitorados.
    Roda Instagrapi E Apify e faz merge por id de comentário — nenhuma fonte
    única interrompe o fluxo.
    """
    posts_com_coments = [p for p in posts if p["total_coments"] > 0]
    if not posts_com_coments:
        log("  Nenhum post com comentários para coletar")
        return {p["url"]: [] for p in posts}

    resultado: dict = {p["url"]: [] for p in posts}
    ids_vistos: set = set()

    def _merge(brutos_novos):
        parcial = _normalizar_comentarios(brutos_novos, posts, posts_com_coments)
        for url, coments in parcial.items():
            for c in coments:
                if c["id"] not in ids_vistos:
                    resultado[url].append(c)
                    ids_vistos.add(c["id"])

    # ── Instagrapi ──────────────────────────────────────────────
    if _INSTAGRAPI_OK:
        log("=== MODULO 2a - Coletando comentários via Instagrapi ===")
        try:
            brutos_ig = _ig.coletar_comentarios(posts_com_coments)
            log(f"  {len(brutos_ig)} comentários brutos (Instagrapi)")
            _merge(brutos_ig)
        except Exception as e:
            log(f"  Instagrapi falhou: {e}")

    # ── Apify ────────────────────────────────────────────────────
    if APIFY_TOKEN:
        log("=== MODULO 2b - Coletando comentários via Apify ===")
        try:
            urls_posts = [p["url"] for p in posts_com_coments]
            input_data = {"directUrls": urls_posts, "resultsLimit": MAX_COMENTARIOS_POR_POST}
            run_id = apify_iniciar_run(ACTOR_COMMENTS, input_data)
            if run_id:
                dataset_id = apify_aguardar_run(run_id, timeout=300)
                if dataset_id:
                    brutos_ap = apify_buscar_resultados(dataset_id, limit=2000)
                    log(f"  {len(brutos_ap)} comentários brutos (Apify)")
                    antes = len(ids_vistos)
                    _merge(brutos_ap)
                    log(f"  {len(ids_vistos) - antes} comentários novos adicionados pelo Apify")
        except Exception as e:
            log(f"  Apify falhou: {e}")

    total_c = sum(len(v) for v in resultado.values())
    log(f"  {total_c} comentários processados de {sum(1 for v in resultado.values() if v)} posts")
    return resultado

# ==============================================================
# MODULO 3 - MEMORIA CONTEXTUAL
# ==============================================================

def carregar_memoria(planilha):
    log("=== MODULO 3 - Carregando memoria ===")
    blocos = []

    try:
        aba = planilha.worksheet("Briefing_Diario")
        linhas = aba.get_all_records()
        recentes = linhas[-7:] if len(linhas) >= 7 else linhas
        if recentes:
            blocos.append("=== CONTEXTO POLITICO DOS ULTIMOS 7 DIAS ===")
            for l in recentes:
                data   = l.get("data", "")
                score  = l.get("score_medio_imagem", "")
                narr   = l.get("narrativa_dominante", "")
                queixa = l.get("queixa_top", "")
                blocos.append(f"  {data} | Score imagem: {score} | Narrativa: {narr} | Queixa: {queixa}")
    except Exception as e:
        log(f"  Briefing_Diario: {e}")

    try:
        aba = planilha.worksheet("Feedback")
        linhas = aba.get_all_records()
        uteis   = [l for l in linhas if str(l.get("valor","")).lower() == "util"][-5:]
        inuteis = [l for l in linhas if str(l.get("valor","")).lower() == "inutil"][-5:]
        if uteis or inuteis:
            blocos.append("\n=== APRENDIZADO DE FEEDBACKS ===")
            for l in uteis:
                blocos.append(f"  + UTIL: {l.get('url','')} | {l.get('resumo','')}")
            for l in inuteis:
                blocos.append(f"  - INUTIL: {l.get('url','')} | {l.get('resumo','')}")
    except Exception:
        pass

    try:
        aba = planilha.worksheet("Padroes")
        linhas = aba.get_all_records()
        ativos = [l for l in linhas if str(l.get("status","")).lower() == "ativo"][-3:]
        if ativos:
            blocos.append("\n=== PADROES ATIVOS ===")
            for l in ativos:
                blocos.append(f"  {l.get('padrao','')}: {l.get('perfis_envolvidos','')}")
    except Exception:
        pass

    memoria = "\n".join(blocos) if blocos else "Sem historico anterior."
    log(f"  Memoria carregada: {len(blocos)} blocos")
    return memoria

# ==============================================================
# MODULO 4 - ANALISE COM O AGORA (Claude)
# ==============================================================

PROMPT_TRIAGEM = (
    "Classificador rapido de risco politico. "
    "REGRA CRITICA DE OTICA: todo sentimento e medido pelo impacto na imagem do "
    "prefeito Gustavo Carmo de Alagoinhas/BA — NAO pelo tom do comentario isolado. "
    "POSITIVO = comentario favorece o prefeito Gustavo (elogio a gestao, defesa do prefeito, "
    "critica a opositores). "
    "NEGATIVO = comentario prejudica o prefeito Gustavo (critica a gestao, apoio a opositor, "
    "queixa sobre servico publico, sarcasmo/ironia sobre a prefeitura). "
    "REGRA PARA PERFIL OPOSITOR: comentarios apoiando/elogiando o opositor = NEGATIVO. "
    "Comentarios concordando com criticas ao prefeito = NEGATIVO. "
    "Apenas comentarios DEFENDENDO o prefeito ou ATACANDO o opositor = POSITIVO. "
    "REGRA PARA PERFIL ALIADO/GOVERNO: comentarios elogiando a gestao = POSITIVO. "
    "REGRA DO NEUTRO (simetrica para POSITIVO e NEGATIVO): comentario que nao menciona "
    "nem implica julgamento sobre a gestao = NEUTRO. "
    "Animacao com artista/banda em evento ('Vamos!', 'Que show!'), reacao emocional pura, "
    "comentario religioso/cultural sem conexao com atos da gestao = NEUTRO, nunca POSITIVO. "
    "Reclamacao sobre terceiros, comercio, outros cidadaos ou tema geral que NAO "
    "responsabiliza a gestao = NEUTRO, nunca NEGATIVO. "
    "Para ser POSITIVO ou NEGATIVO precisa mencionar ou implicar diretamente: prefeito, "
    "prefeitura, gestao, secretaria, obra ou servico publico (ou apoiar/atacar opositor). "
    "Retorne APENAS JSON valido, sem markdown, sem texto extra."
)

def triar_post_rapido(post, comentarios):
    """Monta o prompt curto para a triagem Haiku (passo 1)."""
    cidadaos = sorted(
        [c for c in comentarios if c["tipo"] == "cidadao"],
        key=lambda x: x["curtidas"], reverse=True
    )[:10]
    cat = (post.get("categoria") or "").lower()
    lado = ("OPOSITOR" if cat == "oposicao"
            else "ALIADO" if cat in ("prefeito", "prefeitura", "governo")
            else "IMPRENSA")
    coments_txt = "".join(
        f'  {c["curtidas"]}❤ @{c["username"]}: "{c["texto"][:180]}"\n'
        for c in cidadaos
    ) or "  Nenhum comentario.\n"
    nota_lado = (
        "ATENCAO: este e um perfil OPOSITOR. Comentarios apoiando/elogiando este perfil "
        "= NEGATIVO para o prefeito. So e POSITIVO se o comentario defende Gustavo ou "
        "ataca o opositor diretamente."
        if lado == "OPOSITOR" else
        "ATENCAO: este e um perfil ALIADO/GOVERNO. Comentarios elogiando a gestao = "
        "POSITIVO. Criticas = NEGATIVO."
        if lado == "ALIADO" else
        "Analise o conteudo do comentario para determinar o impacto na imagem do prefeito."
    )
    return (
        f'Perfil: @{post["autor"]} ({post["categoria"]}) [LADO: {lado}]\n'
        f'{nota_lado}\n'
        f'Caption: {post["caption"][:200] or "(sem legenda)"}\n\n'
        f'COMENTARIOS (top {len(cidadaos)} por curtidas — otica do prefeito Gustavo Carmo):\n'
        f'{coments_txt}\n'
        'Retorne JSON (pct_pos e pct_neg = % dos comentarios acima FAVORAVEIS / CONTRARIOS ao prefeito Gustavo):\n'
        '{"score_risco":<0-100>,"urgencia":"<alta|media|baixa>",'
        '"tema":"<saude|educacao|obras|seguranca|transporte|emprego|impostos|outros>",'
        '"sentimento_comentarios":"<positivo|negativo|neutro|misto>",'
        '"comentarios_pct_pos":<0-100>,"comentarios_pct_neg":<0-100>}'
    )


PROMPT_SISTEMA = """Voce e o AGORA, agente de inteligencia politica especializado em monitorar
a imagem publica do prefeito Gustavo Carmo e da Prefeitura de Alagoinhas/BA.

Seu objetivo principal e analisar os COMENTARIOS dos cidadaos nos posts do Instagram,
pois a reacao do cidadao comum e o verdadeiro termometro da imagem do prefeito.
O post e apenas o gatilho - o que importa e o que o povo respondeu.

═══════════════════════════════════════════════════════════════════════
REGRA CENTRAL DE POLARIDADE (CRITICA - APLIQUE EM TODAS AS ANALISES):
═══════════════════════════════════════════════════════════════════════
O alvo da analise e SEMPRE o prefeito Gustavo Carmo e sua gestao municipal.
Todo sentimento e classificado sob a OTICA DO PREFEITO ATUAL, independente
de em qual perfil o comentario foi feito.

  POSITIVO = favorece a imagem do prefeito Gustavo Carmo
    - Elogio direto ao prefeito ou a gestao municipal
    - Defesa do prefeito contra criticas
    - Critica/ataque a OPOSITORES de Gustavo (vereadores opositores,
      Luciano Almeida, Joaquim Neto, Jaldice Nunes, Paulo Cezar, etc.)
    - Apoio a obras, programas ou secretarias da prefeitura
    - Lembrar realizacoes da gestao positivamente

  NEGATIVO = prejudica a imagem do prefeito Gustavo Carmo
    - Critica direta ao prefeito ou a gestao municipal
    - APOIO/elogio a opositores ("vai ser nosso proximo prefeito",
      "Luciano e melhor", "Joaquim ja deveria estar na prefeitura")
    - Queixas concretas sobre servicos municipais (saude, educacao,
      obras, limpeza, IPTU, transporte)
    - Comparacoes desfavoraveis com outras gestoes/cidades
    - Sarcasmo, ironia ou descrenca sobre promessas (ver secao IRONIA abaixo)
    - Acusacao de que o perfil/portal e "pago", "patrocinado" ou "passa pano" pela gestao

  NEUTRO = nao avalia a gestao municipal — NAO contribui para pct_pos nem pct_neg
    - Pergunta sobre horario, endereco, informacao pratica
    - Comentario off-topic (sem relacao com gestao)
    - Mencao factual sem juizo de valor
    - Animacao com artista, banda ou atracao em evento ("Vamos q vamos!", "A banda X ta incrivel!")
      sem mencionar ou avaliar a organizacao/gestao
    - Comentario sobre tema religioso, cultural, esportivo ou pessoal sem conexao
      explicita com atos ou omissoes da gestao municipal
    - Reacao emocional pura (emojis, exclamacoes, agradecimento ao artista)
      que nao menciona prefeito, prefeitura, secretaria ou qualidade dos servicos

  REGRA DECISIVA PARA NEUTRO:
    Faca esta pergunta antes de classificar como positivo:
    "O cidadao esta aprovando a GESTAO MUNICIPAL ou apenas reagindo ao conteudo
    do post (evento, noticia, artista)?"
    Se a resposta for "reagindo ao conteudo" e nao houver mencao explicita
    a acao ou qualidade da gestao -> NEUTRO, NAO POSITIVO.

EXEMPLOS — OBRIGATORIO ACERTAR:
  "Acompanho voce Luciano, vai ser nosso prefeito"          -> NEGATIVO
  "Luciano e incompetente, prefiro Gustavo"                 -> POSITIVO
  "SUS de Alagoinhas da certo, parabens equipe!"            -> POSITIVO
  "Prefeitura abandonou minha rua, ha 2 meses sem luz"      -> NEGATIVO
  "Que horas abre o posto de saude?"                        -> NEUTRO
  "Vamos q vamos 🔥👋" (em post de evento)                 -> NEUTRO (animacao com evento, nao avalia gestao)
  "Banda Xotemania no 'muito mais'! 🔥🔥" (em evento)      -> NEUTRO (elogio ao artista, nao a gestao)
  "Parabens pela organizacao da festa, prefeito!"           -> POSITIVO (elogio explicito a gestao)
  "O engraçado e que ninguem reclama do barulho dos
   paredoes mas quando e a igreja incomoda" (comparacao
   social sem juizo sobre a gestao)                         -> NEUTRO
  "Mas vamos retomar o titulo de terra da laranja e
   plantar nas pracas" (sugestao cultural sem critica
   direta ou elogio a gestao)                               -> NEUTRO

ARMADILHA CRITICA — NAO COMETA ESTE ERRO:
  Cidadao escreve "Vamos q vamos! 🔥" em post de evento da prefeitura.
  ERRADO: sentimento = positivo (entusiasmo nao e aprovacao da gestao)
  CORRETO: sentimento = neutro

  Cidadao menciona artista/banda em post promovido pela prefeitura.
  ERRADO: sentimento = positivo (o elogio e ao artista, nao ao prefeito)
  CORRETO: sentimento = neutro

  Para um comentario ser POSITIVO, precisa mencionar ou implicar diretamente:
  o prefeito, a prefeitura, a gestao, uma secretaria, uma obra, um programa
  municipal ou a qualidade dos servicos publicos.

REGRA SIMETRICA PARA NEGATIVO — APLIQUE COM O MESMO RIGOR:
  O criterio do NEGATIVO e identico ao do POSITIVO, so que com sinal trocado.
  Para um comentario ser NEGATIVO, precisa criticar, cobrar ou implicar falha
  diretamente em: o prefeito, a prefeitura, a gestao, uma secretaria, uma obra,
  um programa municipal, a qualidade dos servicos publicos OU apoiar um opositor.
  Reclamacao, sarcasmo ou desabafo que NAO se dirige a gestao = NEUTRO.

  Faca esta pergunta antes de classificar como negativo:
  "Esta critica e dirigida a GESTAO MUNICIPAL (prefeito/prefeitura/servico) ou
  e sobre terceiros, comercio, outros cidadaos ou um tema geral?"
  Se for sobre terceiros e nao houver responsabilizacao da gestao -> NEUTRO.

EXEMPLOS DE NEGATIVO vs NEUTRO (cobranca x desabafo generico):
  "Cade a programacao de Sao Joao? Vai postar dia 20?"      -> NEGATIVO (cobranca a prefeitura)
  "A festa da prefeitura ta fraca, @gustavoascarmo"         -> NEGATIVO (critica + cita o prefeito)
  "E o comercio aberto em pleno feriado, um desrespeito"    -> NEUTRO (critica ao comercio, nao a gestao)
  "Envia esse video pra CDL"                                -> NEUTRO (direcionado a CDL, sem juizo sobre a gestao)
  "Oq nao vai colocar o pe la 🤣🤣"                         -> NEUTRO (sarcasmo vago sem alvo na gestao)
  "Quem ta reclamando das bandas fica em casa"              -> NEUTRO (briga entre cidadaos, nao avalia a gestao)

  ATENCAO: se o comentario cita @gustavoascarmo, @prefeituraalagoinhas,
  "prefeitura", "prefeito" ou um servico publico com tom de critica/cobranca,
  ENTAO e NEGATIVO — a mencao explicita tira do neutro.
═══════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════
DETECCAO OBRIGATORIA DE IRONIA E SARCASMO:
═══════════════════════════════════════════════════════════════════════
No contexto politico brasileiro, ironia e sarcasmo sao quase sempre
NEGATIVOS. O cidadao ironiza para criticar sem parecer agressivo.
CLASSIFIQUE COMO NEGATIVO quando identificar qualquer um destes
marcadores no texto do comentario:

SINAIS DE IRONIA/SARCASMO EM PORTUGUES:
  1. Emojis de risada (😂 🤣 😆 😅) combinados com "elogio" ou referencia
     a uma "conquista" da gestao = o cidadao esta RINDO DA gestao, nao
     aplaudindo. Emojis de risada em comentarios politicos = critica.
  2. Aspas em palavras positivas: "obra", "conquista", "melhoria",
     "transparencia" = o cidadao NAO acredita naquilo que cita.
  3. "passa pano" ou "passa panismo" = acusacao de defender a gestao
     sem critica; SEMPRE negativo para a imagem da prefeitura.
  4. "mentira cabeluda", "fake", "invencao", "historia" (no sentido de
     invencao) = descrenca na informacao divulgada pela gestao/portal.
  5. "Dos mesmos criadores de..." = ironia comparativa, critica ao historico.
  6. "Se tivesse um premio para X, [gestao/portal] ganharia" = critica
     disfarçada de hipotetico.
  7. Elogio improvavel e exagerado sem contexto positivo real = sarcasmo.
     Ex: "Que maravilha! Perfeito! 😂" num post sobre problema nao resolvido.
  8. Critica ao portal/veiculo de comunicacao de ser "patrocinado" ou
     "vendido" para a prefeitura = NEGATIVO para a gestao.

EXEMPLOS CONCRETOS DE IRONIA -> NEGATIVO:
  "Dos mesmos criadores de '20 mil pessoas no Sao Joao'. 😂😂😂
   Se tivesse um trofeu 'passa pano' essa pagina ganharia!"
  -> NEGATIVO (ironia + "passa pano" + 😂 como critica)

  "Que 'conquista'! 😂😂 Ha 3 anos prometendo e nada feito!"
  -> NEGATIVO (aspas em conquista + 😂 + historico de promessas)

  "Perfeito! Tudo funcionando. 😂😂 Vai la no bairro X e ve como ta."
  -> NEGATIVO (elogio sarcastico + convite ao contraste)

  "Parabens pela 'transparencia'! 😆 Ninguem sabe como gastaram o dinheiro."
  -> NEGATIVO (aspas + 😆 + critica financeira)

  "Essa pagina deveria ganhar um Oscar! 😂 Invencao atras de invencao."
  -> NEGATIVO (ironia comparativa + "invencao")

REGRA DE OURO PARA IRONIA:
  Se o comentario usa 😂/🤣 + palavras aparentemente positivas + critica
  implicita (no mesmo comentario ou num contexto de escandalo/promessa
  nao cumprida), classifique como NEGATIVO, nunca como positivo.
  O emoji 😂 em contexto politico e QUASE SEMPRE sarcasmo, nao alegria.
═══════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════
REGRA CRITICA: COMO CLASSIFICAR "sentimento_post"
═══════════════════════════════════════════════════════════════════════
"sentimento_post" NAO e o tom da legenda (caption) do post.
E o IMPACTO LIQUIDO na imagem do prefeito, medido pela reacao do povo.
O post e apenas o gatilho — o que importa e O QUE O POVO RESPONDEU.

REGRA:
  Se cidadaos criticaram, ironizaram, reclamaram ou apoiaram opositores
  nos comentarios -> sentimento_post = "negativo"
  Se cidadaos elogiaram, defenderam ou apoiaram a gestao -> "positivo"
  Reacao mista sem clara maioria -> "neutro"

REFERENCIA QUANTITATIVA (guia, nao regra absoluta):
  comentarios_pct_neg > 50% -> sentimento_post = "negativo"
  comentarios_pct_pos > 60% -> sentimento_post = "positivo"
  caso contrario            -> "neutro"

ARMADILHA — NAO COMETA ESTE ERRO:
  Prefeito posta sobre evento (caption positiva, promocional) mas os
  comentarios criticam taxas, abandono, contrato suspeito, gestao ruim.
  CORRETO: sentimento_post = "negativo" (a reacao define, nao a caption).

  Portal de noticias publica nota factual mas os comentarios atacam a
  gestao ou acusam o portal de ser patrocinado pela prefeitura.
  CORRETO: sentimento_post = "negativo".

  Portal posta noticia positiva sobre a gestao mas os comentarios sao
  ironicos (emojis 😂, "passa pano", aspas em palavras positivas,
  referencias a "mentiras" anteriores do mesmo portal).
  CORRETO: sentimento_post = "negativo" — a ironia e uma critica, nao
  um elogio.

  Post recebe comentario que PARECE elogio mas usa 😂 ou aspas: nao
  é positivo, e sarcasmo. Reclassifique como negativo.

  O TEXTO DO RESUMO DIZ "comentarios unanimemente negativos" ou
  "acusam de fake" ou "critica ao portal" mas voce classificou
  sentimento_post = "positivo"? Isso e um ERRO. Corrija para negativo.
═══════════════════════════════════════════════════════════════════════

Regras de analise:
1. Priorize comentarios de cidadaos comuns (tipo=cidadao) sobre perfis politicos
2. Identifique a queixa ou elogio mais frequente, nao apenas o sentimento medio
3. Destaque o comentario mais representativo da opiniao publica
4. Detecte padroes: mesma queixa em posts diferentes = pressao organizada
5. Seja preciso e direto - o assessor precisa de acao, nao de analise generica

Responda APENAS com JSON valido, sem markdown, sem texto antes ou depois."""

def montar_prompt(post, comentarios, memoria):
    cidadaos  = [c for c in comentarios if c["tipo"] == "cidadao"]
    politicos = [c for c in comentarios if c["tipo"] == "politico"]
    cidadaos_sorted = sorted(cidadaos, key=lambda x: x["curtidas"], reverse=True)

    # Limita a 20 cidadaos para o prompt nao explodir; o restante herda o
    # sentimento_comentarios geral (fallback no analisar_com_agora).
    cidadaos_top = cidadaos_sorted[:20]

    coments_txt = ""
    if cidadaos_top:
        coments_txt += f"\nCOMENTARIOS DE CIDADAOS (top {len(cidadaos_top)} por curtidas; NUMERADOS para classificacao):\n"
        for idx, c in enumerate(cidadaos_top):
            coments_txt += f'  [{idx}] {c["curtidas"]}❤ @{c["username"]}: "{c["texto"]}"\n'
    if politicos:
        coments_txt += f"\nCOMENTARIOS DE PERFIS POLITICOS ({len(politicos)} total):\n"
        for c in politicos[:5]:
            coments_txt += f'  @{c["username"]}: "{c["texto"]}"\n'

    # Contexto politico explicito do autor (ajuda o Claude a aplicar a regra de polaridade)
    cat_lower = (post.get("categoria") or "").lower()
    if cat_lower == "oposicao":
        lado = "OPOSITOR de Gustavo Carmo — apoio a esse perfil = NEGATIVO p/ Gustavo"
    elif cat_lower in ("prefeito", "prefeitura", "governo"):
        lado = "ALIADO/GESTAO de Gustavo Carmo — apoio a esse perfil = POSITIVO p/ Gustavo"
    elif cat_lower == "imprensa":
        lado = "IMPRENSA — analise o conteudo do comentario, nao o perfil"
    else:
        lado = "neutro/indeterminado"

    prompt = f"""
{memoria}

POST PARA ANALISE
Perfil: @{post["autor"]} ({post["categoria"]}) — LADO POLITICO: {lado}
Data: {post["data_post"]}
URL: {post["url"]}
Curtidas: {post["curtidas"]} | Comentarios totais: {post["total_coments"]}
Caption: {post["caption"] or "(sem legenda)"}

{coments_txt if coments_txt else "Nenhum comentario coletado neste post."}

Retorne APENAS este JSON (sem markdown, sem texto fora do JSON):

{{
  "score_imagem": <0-100, saude da imagem do prefeito>,
  "score_risco": <0-100, risco de crise de imagem>,
  "risco_crise": "<alto|medio|baixo>",
  "sentimento_post": "<positivo|negativo|neutro — IMPACTO na imagem do prefeito pela reacao dos comentarios, NAO o tom da caption>",
  "sentimento_comentarios": "<positivo|negativo|neutro|misto — sentimento medio dos comentarios dos cidadaos>",
  "comentarios_pct_pos": <0-100, percentual de comentarios positivos>,
  "comentarios_pct_neg": <0-100, percentual de comentarios negativos>,
  "queixa_dominante": "<queixa mais frequente nos comentarios ou vazio>",
  "elogio_dominante": "<elogio mais frequente ou vazio>",
  "comentarios_destaque": "<comentario de CIDADAO com MAIS curtidas que melhor representa a opiniao publica — copie o texto EXATO. Se NAO houver comentarios de cidadaos, deixe string vazia. NUNCA escreva 'nenhum comentario coletado' ou similar>",
  "comentarios_destaque_curtidas": <numero exato de curtidas desse comentario, conforme listado acima; 0 se vazio>,
  "comentarios_destaque_autor": "<username do autor desse comentario; vazio se nao houver>",
  "resumo": "<1 frase descrevendo o tom geral dos comentarios e o impacto na imagem>",
  "padrao_detectado": "<campanha coordenada, bot, oposicao organizada ou Isolado>",
  "tema": "<tema principal: saude|educacao|obras|seguranca|transporte|emprego|impostos|outros>",
  "atribuicao": "<prefeito_pessoal|prefeitura_instituicao|secretaria|camara_vereadores|oposicao|governo_estadual|governo_federal|sociedade_civil|outros>",
  "tendencia": "<crescendo|estavel|caindo>",
  "urgencia": "<alta|media|baixa>",
  "sugestao_acao": "<acao concreta: monitorar|responder publicamente|acionar assessoria|conter crise|ampliar positivo>",
  "janela_acao": "<imediato|24h|esta semana>",
  "cluster_crise": "<vitima|acidental|intencional|nenhum — tipo de crise: vitima=gestao sofre ataque/boato; acidental=erro nao-intencional; intencional=descaso/negligencia percebida; nenhum=sem crise>",
  "responsabilidade_atribuida": <numero 0-100, quanto o publico culpa o prefeito Gustavo por esta situacao>,
  "confianca": <numero 0-100, sua confianca nesta classificacao — baixe se texto for ambiguo, ironico ou faltar contexto>,
  "sentimentos_comentarios": [
    /* array com o sentimento de CADA comentario de cidadao listado acima, na MESMA ORDEM dos indices [0], [1], [2]...
       Use apenas: "positivo" | "negativo" | "neutro".

       APLIQUE A REGRA CENTRAL DE POLARIDADE (do system prompt):
       sempre sob a otica do PREFEITO GUSTAVO CARMO.

       - positivo = favorece a imagem do prefeito Gustavo (elogio ao prefeito,
         critica a opositores como Luciano/Joaquim/Jaldice, defesa da gestao).
       - negativo = prejudica a imagem (critica a Gustavo/prefeitura, APOIO a
         opositores, queixa de servico municipal, comparacao desfavoravel).
       - neutro = pergunta pratica, off-topic, sem polaridade clara.

       ATENCAO: se o comentario foi feito em perfil de OPOSITOR e APOIA esse
       opositor, classifique como NEGATIVO (e ruim para Gustavo).
       Se o comentario foi feito em perfil de OPOSITOR e CRITICA esse opositor,
       classifique como POSITIVO (e bom para Gustavo).

       O array DEVE ter exatamente {{LEN}} itens (1 por comentario numerado). */
  ]
}}""".replace("{{LEN}}", str(len(cidadaos_top)))
    return prompt

_DEFAULTS_ANALISE = {
    "score_imagem": 50, "score_risco": 0, "risco_crise": "baixo",
    "sentimento_post": "neutro", "sentimento_comentarios": "neutro",
    "comentarios_pct_pos": 0, "comentarios_pct_neg": 0,
    "queixa_dominante": "", "elogio_dominante": "",
    "comentarios_destaque": "", "comentarios_destaque_curtidas": 0, "comentarios_destaque_autor": "",
    "resumo": "", "padrao_detectado": "Isolado", "tema": "", "atribuicao": "outros",
    "tendencia": "estavel", "urgencia": "baixa", "sugestao_acao": "monitorar",
    "janela_acao": "esta semana", "cluster_crise": "nenhum",
    "responsabilidade_atribuida": 0, "confianca": 0,
    "abordagem_recomendada": "", "por_que_funciona": "", "motivo_alerta": "",
}

def _parse_json_resposta(texto):
    """Remove bloco markdown e faz parse do JSON."""
    texto = texto.strip()
    if texto.startswith("```"):
        texto = texto.split("```")[1]
        if texto.startswith("json"):
            texto = texto[4:]
    return json.loads(texto.strip())

def analisar_com_agora(posts, comentarios_por_post, memoria):
    log(f"=== MODULO 4 - Analisando com o AGORA (triagem 2 niveis | limiar={LIMIAR_TRIAGEM}) ===")
    log(f"    Triagem: {MODELO_ANALISTA} | Profundo: {MODELO_PROFUNDO}")
    cliente = Anthropic(api_key=ANTHROPIC_KEY)
    resultado = []
    n_profundo = n_rapido = 0

    for i, post in enumerate(posts, 1):
        url = post["url"]
        comentarios = comentarios_por_post.get(url, [])
        log(f"  [{i}/{len(posts)}] @{post['autor']} | {len(comentarios)} comentarios")

        # --- Passo 1: triagem rapida (Haiku) —-------------------------------
        triagem = {}
        try:
            rt = cliente.messages.create(
                model=MODELO_ANALISTA,
                max_tokens=180,
                system=PROMPT_TRIAGEM,
                messages=[{"role": "user", "content": triar_post_rapido(post, comentarios)}],
            )
            triagem = _parse_json_resposta(rt.content[0].text)
        except Exception as e:
            log(f"    Triagem falhou ({e}) — defaults")

        score_tri = int(triagem.get("score_risco", 0) or 0)
        analise_profunda = score_tri >= LIMIAR_TRIAGEM or triagem.get("urgencia") == "alta"

        # --- Passo 2: analise profunda (Sonnet) apenas se necessario --------
        analise = {}
        if analise_profunda:
            n_profundo += 1
            log(f"    → Sonnet (score_tri={score_tri}, urgencia={triagem.get('urgencia','')})")
            try:
                resp = cliente.messages.create(
                    model=MODELO_PROFUNDO,
                    max_tokens=1400,
                    system=PROMPT_SISTEMA,
                    messages=[{"role": "user", "content": montar_prompt(post, comentarios, memoria)}],
                )
                analise = _parse_json_resposta(resp.content[0].text)
            except Exception as e:
                log(f"    Sonnet falhou ({e}) — usando triagem")
                analise = dict(triagem)
        else:
            n_rapido += 1
            analise = dict(triagem)

        # Garante todos os campos obrigatorios (triagem so retorna 6 campos)
        for k, v in _DEFAULTS_ANALISE.items():
            analise.setdefault(k, v)
        # score_imagem e risco_crise derivados do score_tri quando nao vieram do Sonnet
        if not analise_profunda:
            analise["score_imagem"] = max(0, min(100, 100 - score_tri))
            analise["risco_crise"]  = ("alto" if score_tri >= 70
                                       else "medio" if score_tri >= 45 else "baixo")
            analise["confianca"]    = 45  # triagem e menos precisa
        analise.setdefault("score_risco", score_tri)

        # Safety net: corrige sentimento_post com base nos percentuais calculados.
        # Garante que o campo reflita a reacao do publico, nao o tom da caption,
        # mesmo que o modelo ignore a regra no prompt.
        pct_neg = float(analise.get("comentarios_pct_neg", 0) or 0)
        pct_pos = float(analise.get("comentarios_pct_pos", 0) or 0)
        if pct_neg > 50:
            analise["sentimento_post"] = "negativo"
        elif pct_pos > 60:
            analise["sentimento_post"] = "positivo"
        elif analise.get("sentimento_post") not in ("positivo", "negativo", "neutro"):
            analise["sentimento_post"] = "neutro"

        post_enriquecido = {**post, **analise}
        post_enriquecido["total_cidadaos"]  = len([c for c in comentarios if c["tipo"] == "cidadao"])
        post_enriquecido["total_politicos"] = len([c for c in comentarios if c["tipo"] == "politico"])

        # Camada SCCT: abordagem deterministica
        _rec = recomendar_abordagem(analise.get("cluster_crise", "nenhum"))
        post_enriquecido["abordagem_recomendada"] = _rec["abordagem"]
        post_enriquecido["por_que_funciona"]      = _rec["por_que"]
        _sc = int(analise.get("score_risco", 0) or 0)
        post_enriquecido["motivo_alerta"] = (
            motivo_do_alerta(_sc, post_enriquecido) if deve_disparar_alerta(_sc, post_enriquecido) else ""
        )
        resultado.append(post_enriquecido)

        # Sentimento individual dos comentarios
        cidadaos_lista = sorted(
            [c for c in comentarios if c["tipo"] == "cidadao"],
            key=lambda x: x["curtidas"], reverse=True
        )
        sentimentos = analise.get("sentimentos_comentarios", []) or []
        fallback = analise.get("sentimento_comentarios", "neutro")
        if fallback == "misto":
            fallback = "neutro"
        classificados = 0
        for idx, c in enumerate(cidadaos_lista):
            if idx < len(sentimentos) and sentimentos[idx] in ("positivo", "negativo", "neutro"):
                c["sentimento"] = sentimentos[idx]
                classificados += 1
            else:
                c["sentimento"] = fallback
        for c in comentarios:
            if c["tipo"] != "cidadao" and not c.get("sentimento"):
                c["sentimento"] = fallback

        modo = "PROFUNDO" if analise_profunda else "rapido"
        log(f"    img={analise.get('score_imagem',50)} risco={_sc} [{modo}] "
            f"{classificados}/{len(cidadaos_lista)} coments classificados")
        time.sleep(1)

    log(f"  {len(resultado)} posts: {n_profundo} profundo (Sonnet), {n_rapido} rapido (Haiku)")
    return resultado

# ==============================================================
# MODULO SCCT - RECOMENDACAO DE ABORDAGEM E OVERRIDE DE ALERTA
# ==============================================================
# Baseado em: SCCT (Coombs) + Image Repair Theory (Benoit).
# A ABORDAGEM (qual estrategia) e deterministica — depende so do cluster,
# nao do humor do modelo. O Claude preenche o cluster; a regra fixa recomenda.

ABORDAGEM_POR_CLUSTER = {
    "vitima": {
        "abordagem": "Esclarecer com evidencia factual (negacao factual + acao corretiva)",
        "por_que": "A gestao e vitima do episodio. Confrontar rapido com fato funciona melhor que o silencio — boato nao confrontado vira verdade percebida.",
    },
    "acidental": {
        "abordagem": "Corrigir e contextualizar (acao corretiva + reducao da ofensa)",
        "por_que": "Erro nao-intencional. Mostrar a correcao e o contexto preserva mais a imagem do que negar — negar soa como arrogancia.",
    },
    "intencional": {
        "abordagem": "Reconhecer e apresentar plano (mortificacao + acao corretiva)",
        "por_que": "O publico atribui alta responsabilidade. Reconhecer e mostrar plano reduz o dano; negar ou minimizar amplia a crise.",
    },
    "nenhum": {
        "abordagem": "Nenhuma acao reativa — monitorar",
        "por_que": "Conteudo neutro/positivo. Se for positivo relevante, vale amplificar nos canais proprios.",
    },
}

def recomendar_abordagem(cluster: str) -> dict:
    """Retorna {abordagem, por_que} pelo cluster SCCT. Regra fixa e auditavel."""
    return ABORDAGEM_POR_CLUSTER.get((cluster or "nenhum").lower(), ABORDAGEM_POR_CLUSTER["nenhum"])

def deve_disparar_alerta(score_risco: int, post: dict) -> bool:
    """Decide se o post dispara alerta no WhatsApp (score ou override SCCT)."""
    if score_risco >= SCORE_RISCO_ALERTA:
        return True
    if not OVERRIDE_ALERTA_ATIVO:
        return False
    if post.get("cluster_crise") != "intencional":
        return False
    if (post.get("responsabilidade_atribuida") or 0) < OVERRIDE_RESPONSABILIDADE_MIN:
        return False
    if score_risco < OVERRIDE_SCORE_MIN:
        return False
    if OVERRIDE_EXIGE_TRACAO:
        crescendo  = post.get("tendencia", "") == "crescendo"
        engaj_alto = (int(post.get("curtidas", 0) or 0) > 300
                      or int(post.get("total_coments", 0) or 0) > 100)
        if not crescendo and not engaj_alto:
            return False
    return True

def motivo_do_alerta(score_risco: int, post: dict) -> str:
    """Explica em texto por que o post disparou alerta (Sheets + WhatsApp)."""
    if score_risco >= SCORE_RISCO_ALERTA:
        return f"Score risco {score_risco} >= {SCORE_RISCO_ALERTA}"
    tracao = "tendencia em alta" if post.get("tendencia") == "crescendo" else "engajamento alto"
    return (f"Override SCCT — crise {post.get('cluster_crise', '')}, "
            f"responsabilidade {post.get('responsabilidade_atribuida', '?')}/100, "
            f"{tracao} (score {score_risco})")


# ==============================================================
# MODULO 5 - GRAVACAO NO SHEETS
# ==============================================================

CABECALHO_RADAR = [
    "url", "data_post", "autor", "categoria",
    "curtidas", "comentarios_total", "total_cidadaos", "total_politicos",
    "sentimento_post", "sentimento_comentarios",
    "comentarios_pct_pos", "comentarios_pct_neg",
    "score_imagem", "score_risco", "risco_crise",
    "queixa_dominante", "elogio_dominante",
    "comentarios_destaque", "comentarios_destaque_curtidas", "comentarios_destaque_autor", "resumo",
    "padrao_detectado", "tema", "atribuicao", "tendencia",
    "urgencia", "sugestao_acao", "janela_acao",
    "caption", "atualizado_em",
    # camada de inteligencia SCCT (Coombs / Benoit)
    "cluster_crise", "responsabilidade_atribuida", "confianca",
    "abordagem_recomendada", "por_que_funciona", "motivo_alerta",
]

CABECALHO_COMENTARIOS = [
    "url_post", "autor_post", "categoria_post", "data_post",
    "comentario_id", "username", "tipo", "texto", "curtidas", "data_comentario",
    "atualizado_em"
]

CABECALHO_BRIEFING = [
    "data", "hora", "score_medio_imagem", "score_medio_risco",
    "posts_analisados", "comentarios_cidadaos",
    "narrativa_dominante", "queixa_top", "perfil_mais_ativo",
    "posts_urgencia_alta", "alertas_enviados"
]

def gravar_no_sheets(planilha, posts_analisados, comentarios_por_post):
    log("=== MODULO 5 - Gravando no Sheets ===")
    agora = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Aba Radar
    aba_radar = garantir_aba(planilha, "Radar", CABECALHO_RADAR)
    existentes = set()
    try:
        todas = aba_radar.get_all_records()
        existentes = {r.get("url", "") for r in todas}
    except Exception:
        pass

    # Acumula as linhas novas e grava em UM único append_rows (1 chamada de API
    # em vez de N) — evita o erro 429 (cota de escrita/min do Google Sheets).
    linhas_radar = []
    for p in posts_analisados:
        if p["url"] in existentes:
            continue
        linha = [
            p.get("url", ""), p.get("data_post", ""), p.get("autor", ""),
            p.get("categoria", ""), p.get("curtidas", 0), p.get("total_coments", 0),
            p.get("total_cidadaos", 0), p.get("total_politicos", 0),
            p.get("sentimento_post", ""), p.get("sentimento_comentarios", ""),
            p.get("comentarios_pct_pos", 0), p.get("comentarios_pct_neg", 0),
            p.get("score_imagem", 50), p.get("score_risco", 0),
            p.get("risco_crise", "baixo"),
            p.get("queixa_dominante", ""), p.get("elogio_dominante", ""),
            p.get("comentarios_destaque", ""),
            p.get("comentarios_destaque_curtidas", 0),
            p.get("comentarios_destaque_autor", ""),
            p.get("resumo", ""),
            p.get("padrao_detectado", ""), p.get("tema", ""),
            p.get("atribuicao", ""), p.get("tendencia", "estavel"),
            p.get("urgencia", "baixa"),
            p.get("sugestao_acao", ""), p.get("janela_acao", ""),
            p.get("caption", "")[:200], agora,
            # SCCT
            p.get("cluster_crise", "nenhum"), p.get("responsabilidade_atribuida", 0),
            p.get("confianca", 0), p.get("abordagem_recomendada", ""),
            p.get("por_que_funciona", ""), p.get("motivo_alerta", ""),
        ]
        linhas_radar.append(linha)
        existentes.add(p["url"])
    if linhas_radar:
        aba_radar.append_rows(linhas_radar, value_input_option="RAW")
    novos_radar = len(linhas_radar)

    log(f"  Radar: {novos_radar} posts novos gravados")

    # Aba Comentarios_Analisados
    aba_coments = garantir_aba(planilha, "Comentarios_Analisados", CABECALHO_COMENTARIOS)
    ids_existentes = set()
    try:
        todas_c = aba_coments.get_all_records()
        ids_existentes = {str(r.get("comentario_id", "")) for r in todas_c}
    except Exception:
        pass

    linhas_coments = []
    for post in posts_analisados:
        url = post["url"]
        comentarios = comentarios_por_post.get(url, [])
        for c in comentarios:
            cid = str(c.get("id", ""))
            if cid and cid in ids_existentes:
                continue
            linha_c = [
                url, post.get("autor", ""), post.get("categoria", ""),
                post.get("data_post", ""), cid, c.get("username", ""),
                c.get("tipo", ""), c.get("texto", ""), c.get("curtidas", 0),
                c.get("data", ""), agora,
            ]
            linhas_coments.append(linha_c)
            if cid:
                ids_existentes.add(cid)
    if linhas_coments:
        aba_coments.append_rows(linhas_coments, value_input_option="RAW")
    novos_coments = len(linhas_coments)

    log(f"  Comentarios: {novos_coments} novos gravados")
    return novos_radar, novos_coments

# ==============================================================
# MODULO 5c - DUAL-WRITE SUPABASE (opcional, nao quebra se ausente)
# ==============================================================

def _supabase_upsert(tabela, linhas, on_conflict):
    """Upsert via PostgREST. Retorna qtd gravada ou 0 em falha/desativado."""
    if not SUPABASE_URL or not SUPABASE_KEY or not linhas:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?on_conflict={on_conflict}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    try:
        r = requests.post(url, headers=headers, data=json.dumps(linhas), timeout=30)
        if r.status_code in (200, 201, 204):
            return len(linhas)
        log(f"    Supabase {tabela}: HTTP {r.status_code} {r.text[:160]}")
        return 0
    except Exception as e:
        log(f"    Supabase {tabela}: erro {e}")
        return 0

def _supabase_patch(tabela, filtro, payload):
    """PATCH (update) em massa via PostgREST. Ex: filtro='tenant=eq.alagoinhas'."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?{filtro}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    try:
        r = requests.patch(url, headers=headers, data=json.dumps(payload), timeout=30)
        return r.status_code in (200, 204)
    except Exception as e:
        log(f"    Supabase PATCH {tabela}: erro {e}")
        return False

def _supabase_get(tabela, params):
    """SELECT via PostgREST. params ex: 'tenant=eq.x&select=*&limit=2000'. Retorna lista."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?{params}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        log(f"    Supabase GET {tabela}: erro {e}")
        return []

def _supabase_delete(tabela, filtro):
    """DELETE em massa via PostgREST."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?{filtro}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Prefer": "return=minimal"}
    try:
        r = requests.delete(url, headers=headers, timeout=30)
        return r.status_code in (200, 204)
    except Exception as e:
        log(f"    Supabase DELETE {tabela}: erro {e}")
        return False

def gravar_no_supabase(posts_analisados, comentarios_por_post):
    """Espelha os dados no Postgres do Supabase. Sheets continua como fonte da verdade."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("  Supabase OFF (dual-write ignorado) — dashboard NAO sera atualizado")
        return
    log("=== MODULO 5c - Dual-write Supabase ===")
    agora = datetime.now().isoformat()

    posts_rows = []
    for p in posts_analisados:
        if not p.get("url"):
            continue
        _ppos = float(p.get("comentarios_pct_pos", 0) or 0)
        _pneg = float(p.get("comentarios_pct_neg", 0) or 0)
        if _ppos + _pneg > 100:
            _tot = _ppos + _pneg
            _ppos, _pneg = _ppos / _tot * 100, _pneg / _tot * 100
        posts_rows.append({
            "url": p.get("url"), "tenant": TENANT,
            "data_post": p.get("data_post", ""), "autor": p.get("autor", ""),
            "categoria": p.get("categoria", ""),
            "curtidas": int(p.get("curtidas", 0) or 0),
            "comentarios_total": int(p.get("total_coments", 0) or 0),
            "total_cidadaos": int(p.get("total_cidadaos", 0) or 0),
            "total_politicos": int(p.get("total_politicos", 0) or 0),
            "sentimento_post": p.get("sentimento_post", ""),
            "sentimento_comentarios": p.get("sentimento_comentarios", ""),
            "comentarios_pct_pos": _ppos,
            "comentarios_pct_neg": _pneg,
            "score_imagem": int(p.get("score_imagem", 50) or 50),
            "score_risco": int(p.get("score_risco", 0) or 0),
            "risco_crise": p.get("risco_crise", "baixo"),
            "queixa_dominante": p.get("queixa_dominante", ""),
            "elogio_dominante": p.get("elogio_dominante", ""),
            "comentarios_destaque": p.get("comentarios_destaque", ""),
            "comentarios_destaque_curtidas": int(p.get("comentarios_destaque_curtidas", 0) or 0),
            "comentarios_destaque_autor": p.get("comentarios_destaque_autor", ""),
            "resumo": p.get("resumo", ""),
            "padrao_detectado": p.get("padrao_detectado", ""),
            "tema": p.get("tema", ""), "atribuicao": p.get("atribuicao", ""),
            "tendencia": p.get("tendencia", "estavel"),
            "urgencia": p.get("urgencia", "baixa"),
            "sugestao_acao": p.get("sugestao_acao", ""),
            "janela_acao": p.get("janela_acao", ""),
            "caption": (p.get("caption", "") or "")[:500],
            "atualizado_em": agora,
        })
    n_posts = _supabase_upsert("posts", posts_rows, "url")

    coment_rows = []
    for post in posts_analisados:
        url = post.get("url", "")
        for c in comentarios_por_post.get(url, []):
            cid = str(c.get("id", "")).strip()
            if not cid:
                continue
            coment_rows.append({
                "id": cid, "tenant": TENANT, "url_post": url,
                "autor_post": post.get("autor", ""), "categoria_post": post.get("categoria", ""),
                "username": c.get("username", ""), "tipo": c.get("tipo", ""),
                "texto": c.get("texto", ""), "curtidas": int(c.get("curtidas", 0) or 0),
                "sentimento": c.get("sentimento", "neutro"),
                # Reseta flags de coordenação a cada execução (gravar_narratives remarca depois)
                "suspeito_coordenacao": False, "motivo_suspeita": "",
                "data_comentario": str(c.get("data", "")), "atualizado_em": agora,
            })
    n_coments = _supabase_upsert("comments", coment_rows, "id")
    log(f"  Supabase: {n_posts} posts, {n_coments} comentarios espelhados")


# ==============================================================
# MODULO 5d - INDICES + DAILY_METRICS (Fase 3 - Central de Crises)
# ==============================================================

def _sent(p):
    return str(p.get("sentimento_post", "")).strip().lower()

def _dia_iso(s):
    """dd/mm/yyyy [hh:mm] -> 'yyyy-mm-dd' (ou None)."""
    try:
        parts = str(s).split(" ")[0].split("/")
        if len(parts) == 3:
            return f"{int(parts[2]):04d}-{int(parts[1]):02d}-{int(parts[0]):02d}"
    except Exception:
        pass
    return None

def calc_iad(posts):
    """Indice de Aprovacao Digital (0-100) — sentimento de comentarios ponderado por volume."""
    sPos = sNeg = sNeu = 0.0
    for p in posts:
        n = int(p.get("total_coments", 0) or p.get("comentarios_total", 0) or 0)
        peso = 1 + math.log10(1 + n)
        pPos = float(p.get("comentarios_pct_pos", 0) or 0) / 100
        pNeg = float(p.get("comentarios_pct_neg", 0) or 0) / 100
        pNeu = max(0.0, 1 - pPos - pNeg)
        sPos += peso * pPos
        sNeg += peso * pNeg
        sNeu += peso * pNeu
    tot = sPos + sNeg + sNeu
    if tot == 0:
        return 0.0
    return max(0.0, min(100.0, 100 * (sPos + 0.5 * sNeu) / tot))

def calc_ica(posts):
    """Indice de Confianca da Amostra (0-100)."""
    if not posts:
        return 0.0
    nComents = sum(int(p.get("total_coments", 0) or 0) for p in posts)
    fVol = min(1.0, math.log10(1 + nComents) / math.log10(1 + 500))
    perfis = len(set(p.get("autor", "") for p in posts))
    fFontes = min(1.0, perfis / 8)
    # recencia
    dias = [d for d in (_dia_iso(p.get("data_post", "")) for p in posts) if d]
    fRec = 1.0
    if dias:
        mais_recente = max(dias)
        try:
            dt = datetime.strptime(mais_recente, "%Y-%m-%d")
            horas = max(0, (datetime.now() - dt).total_seconds() / 3600)
            fRec = math.exp(-horas / 48)
        except Exception:
            fRec = 1.0
    tot = len(posts)
    pPos = sum(1 for p in posts if _sent(p) == "positivo") / tot * 100
    pNeg = sum(1 for p in posts if _sent(p) == "negativo") / tot * 100
    fBal = 1 - abs(pPos - pNeg) / 100 * 0.3
    return max(0.0, min(100.0, 100 * (0.45 * fVol + 0.25 * fFontes + 0.20 * fRec + 0.10 * fBal)))

def calc_risco(posts, iad, ica):
    """Risco politico (0-100) + nivel de crise."""
    tot = len(posts) or 1
    pctRiscoAlto = sum(1 for p in posts if str(p.get("risco_crise", "")).strip().lower() == "alto") / tot * 100
    risco = max(0.0, min(100.0, 0.35 * (100 - iad) + 0.25 * pctRiscoAlto + 0.05 * (100 - ica)))
    if risco >= 80:
        nivel = "critico"
    elif risco >= 60:
        nivel = "alto"
    elif risco >= 40:
        nivel = "moderado"
    else:
        nivel = "baixo"
    if ica < 40 and nivel == "critico":
        nivel = "alto"
    return risco, nivel

def gravar_daily_metrics(posts_analisados):
    """Calcula e grava os indices por dia no Supabase (historico da Central de Crises)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    by_day = {}
    for p in posts_analisados:
        d = _dia_iso(p.get("data_post", ""))
        if d:
            by_day.setdefault(d, []).append(p)
    rows = []
    for dia, ps in by_day.items():
        iad = calc_iad(ps)
        ica = calc_ica(ps)
        risco, nivel = calc_risco(ps, iad, ica)
        tot = len(ps) or 1
        pos = sum(1 for p in ps if _sent(p) == "positivo")
        neg = sum(1 for p in ps if _sent(p) == "negativo")
        neu = tot - pos - neg
        rows.append({
            "tenant": TENANT, "dia": dia,
            "iad": round(iad, 1), "ica": round(ica, 1), "risco": round(risco, 1),
            "nivel_crise": nivel,
            "volume_posts": len(ps),
            "volume_coments": sum(int(p.get("total_coments", 0) or 0) for p in ps),
            "pct_pos": round(pos / tot * 100), "pct_neg": round(neg / tot * 100),
            "pct_neu": round(neu / tot * 100),
        })
    n = _supabase_upsert("daily_metrics", rows, "tenant,dia")
    log(f"  Supabase daily_metrics: {n} dias atualizados")


# ==============================================================
# MODULO 7 - ASSISTENTE ESTRATEGICO (IA) -> ai_briefings
# ==============================================================

PROMPT_BRIEFING = """Voce e o estrategista-chefe de comunicacao politica do prefeito
Gustavo Carmo (Alagoinhas/BA). Recebe o retrato digital do dia e produz um briefing
ACIONAVEL para o gabinete. Seja concreto, direto e pratico — nada de generico.
Responda APENAS com JSON valido, sem markdown.

REGRA DE NUMEROS (CRITICA): o campo "diagnostico" NUNCA pode conter valores
numericos — nada de IAD, risco, percentuais, contagens de posts ou comentarios.
Descreva a imagem em linguagem QUALITATIVA: use as palavras do nivel ("risco baixo",
"risco moderado", "risco alto") e descreva a proporcao em texto ("maioria dos
comentarios critica", "leve saldo negativo", "elogios isolados"). Os numeros aparecem
nos paineis do dashboard; sua funcao e INTERPRETA-LOS em palavras, nunca repeti-los.
Exemplos do que NAO escrever: "IAD 52", "risco 21", "43% negativos", "29% positivos",
"13 posts". Exemplos do que escrever: "imagem em risco baixo", "saldo negativo
relevante", "a maioria dos comentarios do dia foi critica"."""

# Salvaguarda: detecta numeros-metrica cravados no diagnostico (IAD, risco, %,
# contagens de posts/comentarios) que deveriam viver so nos cards do dashboard.
# Nao casa valores factuais como "R$160 mil" (fato de denuncia, nao metrica).
_PADRAO_NUMERO_DIAGNOSTICO = re.compile(
    r"\bIAD\b\s*\d|\brisco\b\s*\d|\d+\s*%|\d+\s*(?:posts?|coment)",
    re.IGNORECASE,
)

def gerar_briefing_estrategico(posts_analisados):
    """Gera o briefing diario com Claude e grava em ai_briefings."""
    if not SUPABASE_URL or not SUPABASE_KEY or not posts_analisados:
        if not posts_analisados:
            return
        log("  Briefing IA: Supabase nao configurado - pulando")
        return
    log("=== MODULO 7 - Assistente Estrategico (IA) ===")

    iad = calc_iad(posts_analisados)
    ica = calc_ica(posts_analisados)
    risco, nivel = calc_risco(posts_analisados, iad, ica)
    tot = len(posts_analisados) or 1
    pos = sum(1 for p in posts_analisados if _sent(p) == "positivo")
    neg = sum(1 for p in posts_analisados if _sent(p) == "negativo")

    temas, queixas, elogios = {}, {}, {}
    for p in posts_analisados:
        if p.get("tema"): temas[p["tema"]] = temas.get(p["tema"], 0) + 1
        if p.get("queixa_dominante"): queixas[p["queixa_dominante"]] = queixas.get(p["queixa_dominante"], 0) + 1
        if p.get("elogio_dominante"): elogios[p["elogio_dominante"]] = elogios.get(p["elogio_dominante"], 0) + 1
    top_temas   = sorted(temas.items(),   key=lambda x: -x[1])[:5]
    top_queixas = sorted(queixas.items(), key=lambda x: -x[1])[:5]
    top_elogios = sorted(elogios.items(), key=lambda x: -x[1])[:3]
    top_posts   = sorted(posts_analisados, key=lambda p: int(p.get("score_risco", 0) or 0), reverse=True)[:5]

    ctx  = f"INDICES DO DIA:\n"
    ctx += f"  Aprovacao Digital (IAD): {iad:.0f}/100\n"
    ctx += f"  Confianca da Amostra (ICA): {ica:.0f}/100\n"
    ctx += f"  Risco Politico: {risco:.0f}/100 (nivel: {nivel})\n"
    ctx += f"  Posts: {tot} | Positivos: {round(pos/tot*100)}% | Negativos: {round(neg/tot*100)}%\n\n"
    ctx += "TEMAS DOMINANTES: " + ", ".join(f"{t} ({n})" for t, n in top_temas) + "\n"
    if top_queixas:
        ctx += "PRINCIPAIS QUEIXAS: " + " | ".join(f"{q} ({n})" for q, n in top_queixas) + "\n"
    if top_elogios:
        ctx += "PRINCIPAIS ELOGIOS: " + " | ".join(f"{e} ({n})" for e, n in top_elogios) + "\n"
    ctx += "\nPOSTS MAIS CRITICOS:\n"
    for p in top_posts:
        ctx += f"  @{p.get('autor','')} ({p.get('categoria','')}) | tema: {p.get('tema','')} | risco: {p.get('score_risco',0)} | {p.get('sentimento_post','')}\n"
        if p.get("comentarios_destaque"):
            ctx += f"     comentario: \"{p.get('comentarios_destaque','')[:160]}\"\n"

    prompt = ctx + """
Retorne APENAS este JSON:
{
  "diagnostico": "<2-3 frases QUALITATIVAS: como esta a imagem hoje e por que. PROIBIDO citar numeros (IAD, risco, %, contagens) — descreva tudo em palavras. Ex: 'A imagem esta em risco baixo, mas com saldo negativo relevante: a maioria dos comentarios do dia critica o Sao Joao — banda atrasada, contrato sob suspeita e infraestrutura precaria. Um perfil fiscal critico ja anunciou cobertura adversaria continua.'>",
  "oportunidades": [{"titulo":"...","acao":"...","impacto":"alto|medio|baixo","esforco":"alto|medio|baixo"}],
  "alertas": [{"nivel":"baixo|moderado|alto|critico","tema":"...","janela":"imediato|24h|esta semana"}],
  "recomendacoes_comunicacao": [{"canal":"...","mensagem":"...","tom":"...","timing":"..."}]
}
Maximo 3 itens por lista. Seja especifico ao contexto de Alagoinhas."""

    try:
        cliente = Anthropic(api_key=ANTHROPIC_KEY)
        resp = cliente.messages.create(
            model=MODELO_PROFUNDO,
            max_tokens=1500,
            system=PROMPT_BRIEFING,
            messages=[{"role": "user", "content": prompt}],
        )
        txt = resp.content[0].text.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[1]
            if txt.startswith("json"):
                txt = txt[4:]
        data = json.loads(txt.strip())
    except Exception as e:
        log(f"  Briefing IA: erro {e}")
        return

    # Salvaguarda: o diagnostico deve ser qualitativo. Se a IA cravou um numero-metrica
    # (IAD, risco, %, contagem), loga para monitoramento — texto e mantido para nao
    # mutilar a frase; o sinal serve para revisar/reforcar o prompt.
    _leak = _PADRAO_NUMERO_DIAGNOSTICO.search(data.get("diagnostico", "") or "")
    if _leak:
        log(f"  ⚠ Briefing: diagnostico contem numero cravado ('{_leak.group(0).strip()}') "
            f"— deveria ser qualitativo. Texto mantido; revisar PROMPT_BRIEFING.")

    hoje = datetime.now().strftime("%Y-%m-%d")
    row = [{
        "tenant": TENANT, "dia": hoje,
        "nivel_crise": nivel, "risco": round(risco, 1),
        "diagnostico": data.get("diagnostico", ""),
        "oportunidades": data.get("oportunidades", []),
        "alertas": data.get("alertas", []),
        "recomendacoes": data.get("recomendacoes_comunicacao", data.get("recomendacoes", [])),
        "gerado_em": datetime.now().isoformat(),
    }]
    n = _supabase_upsert("ai_briefings", row, "tenant,dia")
    log(f"  Briefing IA gravado: {n} (nivel {nivel}, {len(data.get('recomendacoes_comunicacao', []))} recomendacoes)")
    return {"nivel": nivel, "risco": round(risco, 1), "iad": round(iad, 1), "ica": round(ica, 1), **data}


# ==============================================================
# AGENTE: CAÇADOR DE CRISES (multi-agente, Fase B)
# ==============================================================

PROMPT_CACADOR = """Voce e o CAÇADOR DE CRISES, agente especializado em gestao de crises de
imagem do prefeito Gustavo Carmo (Alagoinhas/BA). Recebe um post sinalizado como ALTO RISCO
e decide, com frieza tatica, se e crise real e o que fazer.

Sua missao NAO e alarmar — e separar ruido de crise verdadeira e dar um plano acionavel.
Considere o historico de risco: risco subindo + comentarios organizados = crise real.
Reclamacao isolada, mesmo agressiva, raramente e crise.

Responda APENAS com JSON valido, sem markdown."""

def _registrar_agente(agente, modelo, gatilho, input_ref, tokens_in, tokens_out):
    """Auditoria de execução de agente (agent_runs)."""
    _supabase_upsert("agent_runs", [{
        "tenant": TENANT, "agente": agente, "modelo": modelo,
        "gatilho": gatilho, "input_ref": input_ref,
        "tokens_in": tokens_in, "tokens_out": tokens_out,
        "criado_em": datetime.now().isoformat(),
    }], "id")

def _chamar_claude(modelo, system, prompt, max_tokens=1200):
    """Chama Claude com fallback p/ Haiku se o modelo configurado falhar."""
    cliente = Anthropic(api_key=ANTHROPIC_KEY)
    try:
        r = cliente.messages.create(model=modelo, max_tokens=max_tokens,
                                    system=system, messages=[{"role": "user", "content": prompt}])
        return r, modelo
    except Exception as e:
        if modelo != MODELO_ANALISTA:
            log(f"    {modelo} falhou ({str(e)[:60]}) — fallback p/ Haiku")
            r = cliente.messages.create(model=MODELO_ANALISTA, max_tokens=max_tokens,
                                        system=system, messages=[{"role": "user", "content": prompt}])
            return r, MODELO_ANALISTA
        raise

def agente_cacador_crises(post, comentarios, tendencia_risco):
    """Analisa 1 post de alto risco e gera plano de contenção."""
    cidadaos = sorted([c for c in comentarios if c.get("tipo") == "cidadao"],
                      key=lambda x: int(x.get("curtidas", 0) or 0), reverse=True)
    coments_txt = ""
    for c in cidadaos[:12]:
        coments_txt += f'  {c.get("curtidas",0)}❤ @{c.get("username","")}: "{c.get("texto","")[:160]}"\n'

    prompt = f"""POST DE ALTO RISCO
Perfil: @{post.get('autor','')} ({post.get('categoria','')})
Tema: {post.get('tema','')} | Score de risco: {post.get('score_risco',0)}/100
Caption: {post.get('caption','') or '(sem legenda)'}
Sentimento dos comentarios: {post.get('sentimento_comentarios','')}

COMENTARIOS MAIS CURTIDOS:
{coments_txt or '  (nenhum comentario)'}

CONTEXTO — risco dos ultimos dias: {tendencia_risco}

Retorne APENAS este JSON:
{{
  "e_crise_real": <true|false>,
  "nivel": "<baixo|moderado|alto|critico>",
  "pavio": "<o que exatamente disparou — 1 frase>",
  "velocidade": "<acelerando|estavel|esfriando>",
  "janela_resposta": "<imediato|24h|esta semana>",
  "plano_contencao": ["<passo concreto 1>", "<passo 2>", "<passo 3>"],
  "risco_se_ignorar": "<o que acontece se nada for feito — 1 frase>"
}}"""
    try:
        resp, modelo_usado = _chamar_claude(CRISIS_MODEL, PROMPT_CACADOR, prompt, max_tokens=1000)
        txt = resp.content[0].text.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[1]
            if txt.startswith("json"): txt = txt[4:]
        data = json.loads(txt.strip())
        _registrar_agente("cacador_crises", modelo_usado, f"score_risco={post.get('score_risco',0)}",
                          post.get("url", ""), resp.usage.input_tokens, resp.usage.output_tokens)
        return data
    except Exception as e:
        log(f"    Cacador de Crises: erro {e}")
        return None

def rodar_cacador_crises(posts_analisados, comentarios_por_post):
    """Orquestra o Caçador: dispara só nos posts de alto risco (teto MAX_CRISES_RUN)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    # Gatilho: score_risco >= 70 OU risco_crise == alto
    candidatos = [p for p in posts_analisados
                  if int(p.get("score_risco", 0) or 0) >= 70
                  or str(p.get("risco_crise", "")).lower() == "alto"]
    if not candidatos:
        return
    log("=== AGENTE - Cacador de Crises ===")
    candidatos.sort(key=lambda p: int(p.get("score_risco", 0) or 0), reverse=True)

    # Tendência de risco recente (contexto p/ o agente)
    hist = _supabase_get("daily_metrics", f"tenant=eq.{TENANT}&select=dia,risco&order=dia.desc&limit=5")
    tend = " → ".join(f"{h['dia'][5:]}:{round(h.get('risco',0))}" for h in reversed(hist)) or "sem historico"

    planos = 0
    for p in candidatos[:MAX_CRISES_RUN]:
        data = agente_cacador_crises(p, comentarios_por_post.get(p.get("url", ""), []), tend)
        if not data:
            continue
        # Normaliza o nível (Claude às vezes retorna 'moderato', 'critico ', etc.)
        _NIVEIS_OK = {"baixo": "baixo", "moderado": "moderado", "moderato": "moderado",
                      "medio": "moderado", "alto": "alto", "critico": "critico", "crítico": "critico"}
        nivel_raw = str(data.get("nivel", "alto")).strip().lower()
        nivel_norm = _NIVEIS_OK.get(nivel_raw, "alto")
        _supabase_upsert("crisis_plans", [{
            "post_url": p.get("url", ""), "tenant": TENANT, "autor": p.get("autor", ""),
            "e_crise_real": bool(data.get("e_crise_real", True)),
            "nivel": nivel_norm,
            "pavio": data.get("pavio", ""),
            "velocidade": data.get("velocidade", ""),
            "janela_resposta": data.get("janela_resposta", ""),
            "plano_contencao": data.get("plano_contencao", []),
            "risco_se_ignorar": data.get("risco_se_ignorar", ""),
            "score_risco": int(p.get("score_risco", 0) or 0),
            "gerado_em": datetime.now().isoformat(),
        }], "post_url")
        planos += 1
        time.sleep(1)
    log(f"  Cacador de Crises: {planos} plano(s) de contencao gerado(s) de {len(candidatos)} candidato(s)")


# ==============================================================
# MODULO 7B - ALERTAS POR LIMIAR
# ==============================================================

def verificar_alertas(posts_analisados):
    """Lê config de alertas do Supabase (ou usa defaults de env) e dispara WhatsApp."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        return

    # Calcula índices do ciclo atual
    iad = calc_iad(posts_analisados)
    total = len(posts_analisados)
    if total == 0:
        return
    neg_pct = round(sum(1 for p in posts_analisados if _sent(p) == "negativo") / total * 100)

    # Lê config do dashboard (tabela alerta_config) — fallback para env vars
    limiar_iad   = int(os.environ.get("ALERTA_IAD_LIMIAR",   40))
    limiar_neg   = int(os.environ.get("ALERTA_NEG_LIMIAR",   60))
    limiar_tema  = int(os.environ.get("ALERTA_TEMA_LIMIAR",  50))

    cfg = _supabase_get("alerta_config", f"tenant_id=eq.{TENANT}&select=tipo,limiar,ativo")
    for row in cfg:
        tipo   = row.get("tipo", "")
        limiar = int(row.get("limiar") or 0)
        ativo  = bool(row.get("ativo", True))
        if not ativo:
            continue
        if tipo == "iad":     limiar_iad  = limiar
        if tipo == "neg_pct": limiar_neg  = limiar
        if tipo == "tema":    limiar_tema = limiar

    alertas = []

    if iad < limiar_iad:
        alertas.append(f"⚠ IAD em {iad}% — abaixo do limiar de {limiar_iad}%. Monitoramento recomendado.")

    if neg_pct > limiar_neg:
        alertas.append(f"🔴 {neg_pct}% dos posts são negativos — acima do limiar de {limiar_neg}%.")

    # Tema com maior negatividade
    tema_map = {}
    for p in posts_analisados:
        t = p.get("tema", "") or ""
        if not t or t == "—": continue
        tema_map.setdefault(t, {"neg": 0, "tot": 0})
        tema_map[t]["tot"] += 1
        if _sent(p) == "negativo": tema_map[t]["neg"] += 1
    for tema, v in tema_map.items():
        if v["tot"] < 3: continue
        pneg = round(v["neg"] / v["tot"] * 100)
        if pneg >= limiar_tema:
            alertas.append(f"⚡ Tema '{tema}' com {pneg}% negativo — acima do limiar de {limiar_tema}%.")
            break

    if not alertas:
        return

    log(f"=== ALERTAS: {len(alertas)} disparo(s) ===")
    data_hoje = datetime.now().strftime("%d/%m/%Y %H:%M")
    mensagem  = f"*🚨 Radar Político — Alerta Automático ({data_hoje})*\n\n"
    mensagem += "\n".join(alertas)
    mensagem += f"\n\n_Alagoinhas/BA · IAD atual: {iad}%_"

    try:
        resp = requests.post(
            f"{EVOLUTION_URL}/message/sendText/{os.environ.get('EVOLUTION_INSTANCE', '')}",
            headers={"Content-Type": "application/json", "apikey": EVOLUTION_KEY},
            json={"number": WHATSAPP_NUMBER, "text": mensagem},
            timeout=15,
        )
        if resp.status_code < 300:
            log(f"  Alerta WhatsApp enviado: {len(alertas)} gatilho(s)")
            # Registra no histórico
            for msg in alertas:
                _supabase_upsert("alerta_historico", [{
                    "tenant_id": TENANT, "tipo": "auto", "valor": iad,
                    "mensagem": msg, "canal": "whatsapp",
                    "criado_em": datetime.now().isoformat(),
                }], "id")
        else:
            log(f"  Alerta WhatsApp: erro {resp.status_code}")
    except Exception as e:
        log(f"  Alerta WhatsApp: falha ({e})")


# ==============================================================
# MODULO 8 - INFLUENCIADORES (ranking)
# ==============================================================

def _classe_influenciador(categoria, alcance):
    """macro >10k | micro 1k-10k | nano <1k | formador (imprensa/politico)."""
    cat = (categoria or "").lower()
    if cat in ("imprensa",):
        return "formador"
    if alcance >= 10000:
        return "macro"
    if alcance >= 1000:
        return "micro"
    return "nano"

def _alinhamento(pct_pos, pct_neg):
    if pct_pos >= 55:
        return "aliado"
    if pct_neg >= 40:
        return "opositor"
    return "neutro"

def _normalizar(v, ref):
    return min(100.0, (v / ref) * 100) if ref > 0 else 0.0

def gravar_influencers(posts_analisados, comentarios_por_post):
    """
    Calcula ranking de influenciadores:
      - Perfis monitorados (14 contas): alcance, engajamento, frequência, alinhamento
      - Cidadãos: top comentaristas por curtidas dos comentários
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    log("=== MODULO 8 - Influenciadores ===")

    # ── PERFIS MONITORADOS ─────────────────────────────────
    by_autor = {}
    for p in posts_analisados:
        a = p.get("autor", "")
        if not a:
            continue
        d = by_autor.setdefault(a, {
            "categoria": p.get("categoria", ""),
            "posts": 0, "curtidas": 0, "coments": 0,
            "pos": 0, "neg": 0, "neu": 0,
        })
        d["posts"]    += 1
        d["curtidas"] += int(p.get("curtidas", 0) or 0)
        d["coments"]  += int(p.get("total_coments", 0) or p.get("comentarios_total", 0) or 0)
        s = _sent(p)
        if s == "positivo": d["pos"] += 1
        elif s == "negativo": d["neg"] += 1
        else: d["neu"] += 1

    if not by_autor:
        log("  Sem perfis para ranquear")
        return

    max_alc  = max((d["curtidas"] for d in by_autor.values()), default=1)
    max_eng  = max(((d["coments"] / d["posts"]) if d["posts"] else 0 for d in by_autor.values()), default=1)
    max_freq = max((d["posts"] for d in by_autor.values()), default=1)

    rows_perfis = []
    for handle, d in by_autor.items():
        engaj  = (d["coments"] / d["posts"]) if d["posts"] else 0
        score  = (
            0.4 * _normalizar(d["curtidas"], max_alc) +
            0.4 * _normalizar(engaj,         max_eng) +
            0.2 * _normalizar(d["posts"],    max_freq)
        )
        tot = d["pos"] + d["neg"] + d["neu"] or 1
        pct_pos = round(d["pos"] / tot * 100, 1)
        pct_neg = round(d["neg"] / tot * 100, 1)
        rows_perfis.append({
            "tenant": TENANT, "handle": handle, "tipo": "perfil_monitorado",
            "categoria": d["categoria"],
            "alcance": d["curtidas"],
            "engajamento": round(engaj, 1),
            "frequencia": d["posts"],
            "influencia_score": round(score, 1),
            "classe": _classe_influenciador(d["categoria"], d["curtidas"]),
            "alinhamento": _alinhamento(pct_pos, pct_neg),
            "pct_positivo": pct_pos,
            "pct_negativo": pct_neg,
            "atualizado_em": datetime.now().isoformat(),
        })

    # ── CIDADÃOS COMENTARISTAS ────────────────────────────
    by_user = {}
    for url, lista in comentarios_por_post.items():
        for c in lista:
            if c.get("tipo") != "cidadao":
                continue
            u = c.get("username", "")
            if not u:
                continue
            d = by_user.setdefault(u, {"curtidas": 0, "n": 0})
            d["curtidas"] += int(c.get("curtidas", 0) or 0)
            d["n"]        += 1

    rows_cidadaos = []
    if by_user:
        # top 30 cidadãos por curtidas totais
        top = sorted(by_user.items(), key=lambda x: -x[1]["curtidas"])[:30]
        max_c = top[0][1]["curtidas"] or 1
        for u, d in top:
            score = _normalizar(d["curtidas"], max_c) * 0.7 + _normalizar(d["n"], 10) * 0.3
            rows_cidadaos.append({
                "tenant": TENANT, "handle": u, "tipo": "cidadao",
                "categoria": "Cidadao",
                "alcance": d["curtidas"],
                "engajamento": d["curtidas"] / max(1, d["n"]),
                "frequencia": d["n"],
                "influencia_score": round(score, 1),
                "classe": "nano",
                "alinhamento": "cidadao",
                "atualizado_em": datetime.now().isoformat(),
            })

    n1 = _supabase_upsert("influencers", rows_perfis,   "tenant,handle,tipo")
    n2 = _supabase_upsert("influencers", rows_cidadaos, "tenant,handle,tipo")
    log(f"  Influencers gravados: {n1} perfis + {n2} cidadaos")


# ==============================================================
# MODULO 9 - NARRATIVAS (clustering por tema + sentimento)
# ==============================================================

import hashlib
import re

# ════════════════════════════════════════════════════════════════
# DETECCAO DE COORDENACAO E BOTS (heuristica local, zero IA)
# ════════════════════════════════════════════════════════════════

_STOPWORDS = {
    "a", "o", "e", "de", "da", "do", "das", "dos", "que", "se", "em", "no",
    "na", "nos", "nas", "com", "para", "por", "um", "uma", "uns", "umas",
    "eu", "tu", "ele", "ela", "voce", "voces", "nos", "eles", "elas",
    "esse", "essa", "isso", "este", "esta", "isto", "aquele", "aquela",
    "mas", "ou", "se", "ja", "tambem", "muito", "mais", "menos", "sim",
    "nao", "ne", "ai", "la", "aqui", "ali", "so", "ate", "como", "pra",
}

def _tokens(texto):
    """Tokeniza para Jaccard: minusculas, sem pontuacao, sem stopwords, len>=3."""
    if not texto:
        return set()
    s = re.sub(r"[^\w\s]", " ", texto.lower())
    return {w for w in s.split() if len(w) >= 3 and w not in _STOPWORDS}

def _jaccard(a, b):
    """Similaridade de Jaccard entre dois conjuntos de tokens (0-1)."""
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0

_RE_USERNAME_GENERICO = re.compile(r"^[a-z]{2,}\d{4,}$|^[a-z]+[._]?\d{4,}$")

def _username_suspeito(u):
    """Heuristica de username de bot: letras+4+digitos no fim."""
    if not u:
        return False
    return bool(_RE_USERNAME_GENERICO.match(u.lower().replace("_", "")))

def detectar_coordenacao(comentarios, limiar_sim=0.6, min_tokens_inter=4, min_tokens_texto=4):
    """
    Detecta sinais de coordenação num grupo de comentários (de um cluster/narrativa).
    Retorna:
      {
        "score": 0-100,
        "sinais": [...],
        "suspeitos": [usernames],
        "marcados": [(idx, motivo), ...]   # para marcar comments.suspeito_coordenacao
      }
    """
    if not comentarios or len(comentarios) < 3:
        return {"score": 0, "sinais": [], "suspeitos": [], "marcados": []}

    n = len(comentarios)
    tokens_por_idx = [_tokens(c.get("texto", "")) for c in comentarios]
    marcados = []
    suspeitos = set()
    sinais = []

    # ── 1. COPIA-COLA: pares com Jaccard >= limiar E interseção >= N tokens ─
    # 3 defesas contra falso-positivo:
    #   (a) ambos os textos têm pelo menos min_tokens_texto tokens distintos
    #   (b) interseção de ≥4 tokens (impede match em 2-3 palavras genéricas)
    #   (c) Jaccard ≥ 0.6 (forte similaridade estrutural)
    idx_similares = set()
    pares_similares = 0
    for i in range(n):
        if len(tokens_por_idx[i]) < min_tokens_texto:
            continue
        for j in range(i + 1, n):
            if len(tokens_por_idx[j]) < min_tokens_texto:
                continue
            a, b = tokens_por_idx[i], tokens_por_idx[j]
            inter = len(a & b)
            if inter < min_tokens_inter:
                continue
            sim = _jaccard(a, b)
            if sim >= limiar_sim:
                idx_similares.add(i)
                idx_similares.add(j)
                pares_similares += 1
    n_similares = len(idx_similares)
    if n_similares >= 2:
        sinais.append(f"copia_cola ({n_similares} comentarios similares, {pares_similares} pares)")
    for i in idx_similares:
        u = comentarios[i].get("username", "")
        if u:
            suspeitos.add(u)
            marcados.append((i, "texto similar a outros comentarios"))

    # ── 2. USERNAMES GENERICOS (regex de bot) ──────────────────────
    user_gen = [i for i, c in enumerate(comentarios) if _username_suspeito(c.get("username", ""))]
    n_user_gen = len(user_gen)
    pct_user_gen = (n_user_gen / n) * 100
    if n_user_gen >= 2:
        sinais.append(f"usernames_genericos ({n_user_gen} contas suspeitas)")
    for i in user_gen:
        u = comentarios[i].get("username", "")
        if u:
            suspeitos.add(u)
            marcados.append((i, "username com padrao de bot"))

    # ── 3. BURST TEMPORAL (>= 5 coments na mesma data) ─────────────
    by_data = {}
    for i, c in enumerate(comentarios):
        d = str(c.get("data", "")).strip()[:10]
        if d:
            by_data.setdefault(d, []).append(i)
    burst_dias = [d for d, lst in by_data.items() if len(lst) >= 5]
    max_burst = max((len(by_data[d]) for d in burst_dias), default=0)
    if burst_dias and len(comentarios) >= 8:
        sinais.append(f"burst_temporal ({max_burst} coments mesmo dia)")

    # ── SCORE COMPOSTO ─────────────────────────────────────────────
    # Cada par similar vale 18 pts (max 90 com 5+ pares = forte coordenação)
    score_copia = min(100, pares_similares * 18)
    # Cada username genérico vale 12 pts
    score_user  = min(100, n_user_gen * 12)
    # Burst SOZINHO não conta (qualquer post viral tem burst); só quando combinado
    # com outros sinais multiplica a relevância
    score_burst = 0
    if burst_dias and len(comentarios) >= 8 and (n_similares >= 2 or n_user_gen >= 2):
        score_burst = 60  # burst + outro sinal = padrão real de campanha
    score = 0.55 * score_copia + 0.30 * score_user + 0.15 * score_burst

    # Dedupe marcados (mesmo idx, motivos diferentes)
    seen = {}
    for idx, mot in marcados:
        if idx not in seen:
            seen[idx] = mot
        else:
            seen[idx] = f"{seen[idx]}; {mot}"
    marcados = list(seen.items())

    return {
        "score": round(score, 1),
        "sinais": sinais,
        "suspeitos": sorted(suspeitos),
        "marcados": marcados,
    }


def detectar_grupos_coordenados(comentarios, limiar_sim=0.6, min_tokens_inter=3, min_tokens_texto=3):
    """
    Detecção GLOBAL: encontra grupos de comentários quase-idênticos em TODO o
    conjunto (componentes conexos por similaridade), independente do tema.
    Um grupo coordenado = >=2 comentarios similares de >=2 contas distintas.

    Retorna:
      {
        "grupos": [ {texto, n_comentarios, usernames[], ids[], sentimento, autor_posts[]}, ... ],
        "flagged": { comentario_id: motivo },
      }
    """
    if not comentarios:
        return {"grupos": [], "flagged": {}}

    n = len(comentarios)
    toks = [_tokens(c.get("texto", "")) for c in comentarios]

    # União-busca (union-find) para componentes conexos
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Dupla condição (evita meme/citação curta como falso-positivo):
    #   (A) >=4 tokens em comum E Jaccard >=0.55  -> muitas palavras especificas iguais
    #   (B) >=3 tokens em comum E Jaccard >=0.70  -> textos quase identicos
    for i in range(n):
        if len(toks[i]) < min_tokens_texto:
            continue
        for j in range(i + 1, n):
            if len(toks[j]) < min_tokens_texto:
                continue
            inter = len(toks[i] & toks[j])
            jac = _jaccard(toks[i], toks[j])
            forte = (inter >= 4 and jac >= 0.55)
            quase_identico = (inter >= 3 and jac >= 0.70)
            if forte or quase_identico:
                union(i, j)

    # Agrupa por raiz
    comps = {}
    for i in range(n):
        comps.setdefault(find(i), []).append(i)

    grupos = []
    flagged = {}
    for raiz, idxs in comps.items():
        if len(idxs) < 2:
            continue
        usernames = {comentarios[i].get("username", "") for i in idxs if comentarios[i].get("username")}
        if len(usernames) < 2:
            continue  # mesma conta repetindo nao e coordenacao entre contas
        # sentimento predominante do grupo
        sents = [comentarios[i].get("sentimento", "neutro") for i in idxs]
        sent_pred = max(set(sents), key=sents.count) if sents else "neutro"
        # representante = comentario mais curtido do grupo
        rep = max(idxs, key=lambda i: int(comentarios[i].get("curtidas", 0) or 0))
        grupos.append({
            "texto": (comentarios[rep].get("texto", "") or "")[:280],
            "n_comentarios": len(idxs),
            "usernames": sorted(usernames),
            "ids": [str(comentarios[i].get("id", "")) for i in idxs],
            "sentimento": sent_pred,
            "autor_posts": sorted({comentarios[i].get("autor_post", comentarios[i].get("autor", "")) for i in idxs}),
        })
        for i in idxs:
            cid = str(comentarios[i].get("id", "")).strip()
            if cid:
                flagged[cid] = "texto quase identico a outras contas (campanha coordenada)"

    # NOTA: heurística de username-bot foi removida — no Brasil, ano de nascimento
    # no @ (ex: luziasantos1958, paulinha2008) é comum e NÃO indica bot.
    # Só flaga comentários que fazem parte de um grupo de texto coordenado (sinal real).

    grupos.sort(key=lambda g: -g["n_comentarios"])
    return {"grupos": grupos, "flagged": flagged}


def _norm_tema(t):
    return (t or "").strip().lower()

def _parse_dt(s):
    """dd/mm/yyyy [hh:mm] -> datetime (ou now)."""
    try:
        parts = str(s).split(" ")
        d = parts[0].split("/")
        hm = parts[1].split(":") if len(parts) > 1 else ["00", "00"]
        if len(d) == 3:
            return datetime(int(d[2]), int(d[1]), int(d[0]), int(hm[0]), int(hm[1]))
    except Exception:
        pass
    return datetime.now()

def _status_narrativa(ultimo_visto):
    horas = (datetime.now() - ultimo_visto).total_seconds() / 3600
    if horas <= 24:
        return "ativa"
    if horas <= 72:
        return "esfriando"
    return "encerrada"

def gravar_narratives(posts_analisados, comentarios_por_post):
    """
    Agrupa posts por (tema + sentimento) e calcula:
      - origem (post mais antigo), volume, amplificação, perfis distintos
      - queixa/elogio dominante, comentário cidadão +curtido do cluster
    """
    if not SUPABASE_URL or not SUPABASE_KEY or not posts_analisados:
        return
    log("=== MODULO 9 - Narrativas ===")

    clusters = {}
    for p in posts_analisados:
        tema = _norm_tema(p.get("tema", ""))
        sent = _sent(p)
        if not tema:
            continue
        key = (tema, sent)
        c = clusters.setdefault(key, {
            "posts": [], "perfis": set(),
            "queixas": {}, "elogios": {},
            "amplificacao": 0, "vol_coments": 0,
            "primeiro_visto": None, "ultimo_visto": None,
            "origem_handle": "", "origem_url": "",
            "comentario_top": "", "comentario_top_curtidas": 0,
            "todos_coments": [],  # p/ detecção de coordenação
        })
        c["posts"].append(p)
        c["perfis"].add(p.get("autor", ""))
        c["amplificacao"] += int(p.get("curtidas", 0) or 0)
        c["vol_coments"]  += int(p.get("total_coments", 0) or p.get("comentarios_total", 0) or 0)

        q = (p.get("queixa_dominante") or "").strip()
        e = (p.get("elogio_dominante") or "").strip()
        if q: c["queixas"][q] = c["queixas"].get(q, 0) + 1
        if e: c["elogios"][e] = c["elogios"].get(e, 0) + 1

        dt = _parse_dt(p.get("data_post", ""))
        if not c["primeiro_visto"] or dt < c["primeiro_visto"]:
            c["primeiro_visto"]  = dt
            c["origem_handle"]   = p.get("autor", "")
            c["origem_url"]      = p.get("url", "")
        if not c["ultimo_visto"] or dt > c["ultimo_visto"]:
            c["ultimo_visto"] = dt

        # comentário cidadão +curtido do cluster + acumula todos p/ coordenação
        for cm in comentarios_por_post.get(p.get("url", ""), []):
            if cm.get("tipo") == "cidadao":
                cur = int(cm.get("curtidas", 0) or 0)
                if cur > c["comentario_top_curtidas"]:
                    c["comentario_top_curtidas"] = cur
                    c["comentario_top"] = (cm.get("texto", "") or "")[:300]
                c["todos_coments"].append(cm)

    # ── DETECÇÃO GLOBAL DE COORDENAÇÃO sobre o BANCO COMPLETO ──────
    # Coordenação é cumulativa: roda sobre TODOS os comentários cidadãos já
    # gravados (não só este scrape), pois campanhas se espalham por vários dias.
    coments_db = _supabase_get("comments",
        f"tenant=eq.{TENANT}&tipo=eq.cidadao&select=id,username,texto,sentimento,curtidas,autor_post&limit=5000")
    base_coments = coments_db if coments_db else [
        cm for lista in comentarios_por_post.values() for cm in lista if cm.get("tipo") == "cidadao"
    ]
    coord_global = detectar_grupos_coordenados(base_coments)
    grupos = coord_global["grupos"]
    suspeitos_globais = coord_global["flagged"]  # id -> motivo

    # Reset GLOBAL: zera flags antigas e apaga grupos antigos antes de regravar
    _supabase_patch("comments", f"tenant=eq.{TENANT}&suspeito_coordenacao=eq.true",
                    {"suspeito_coordenacao": False, "motivo_suspeita": ""})
    _supabase_delete("coordination_groups", f"tenant=eq.{TENANT}")

    # Grava os grupos coordenados (tabela dedicada)
    if grupos:
        grupo_rows = []
        for g in grupos:
            gid = hashlib.md5(f"{TENANT}|{'|'.join(sorted(g['ids']))}".encode()).hexdigest()[:24]
            grupo_rows.append({
                "id": gid, "tenant": TENANT,
                "texto_representativo": g["texto"],
                "n_comentarios": g["n_comentarios"],
                "usernames": g["usernames"],
                "sentimento": g["sentimento"],
                "autor_posts": g["autor_posts"],
                "atualizado_em": datetime.now().isoformat(),
            })
        _supabase_upsert("coordination_groups", grupo_rows, "id")

    rows = []
    for (tema, sent), c in clusters.items():
        # id estável: hash(tenant+tema+sentimento)
        nid = hashlib.md5(f"{TENANT}|{tema}|{sent}".encode()).hexdigest()[:24]
        queixa_top = max(c["queixas"].items(), key=lambda x: x[1])[0] if c["queixas"] else ""
        elogio_top = max(c["elogios"].items(), key=lambda x: x[1])[0] if c["elogios"] else ""
        rotulo_sent = {"positivo": "elogio", "negativo": "crítica", "neutro": "neutro"}.get(sent, sent)
        # Coordenação por narrativa = comentários DESTA narrativa que estão flagged globalmente
        flagged_na_narr = [
            cm for cm in c["todos_coments"]
            if str(cm.get("id", "")) in suspeitos_globais
        ]
        n_flag = len(flagged_na_narr)
        coord_score = min(100, n_flag * 25)  # 2 flagged=50, 3=75, 4+=100
        coord_susp = sorted({cm.get("username", "") for cm in flagged_na_narr if cm.get("username")})
        coord_sinais = []
        if n_flag >= 2:
            coord_sinais.append(f"{n_flag} comentarios coordenados nesta narrativa")
        elif n_flag == 1:
            coord_sinais.append("1 comentario suspeito")
        rows.append({
            "id": nid, "tenant": TENANT,
            "tema": tema.title(), "sentimento": sent,
            "rotulo": f"{tema.title()} — {rotulo_sent}",
            "origem_handle": c["origem_handle"],
            "origem_url": c["origem_url"],
            "primeiro_visto": c["primeiro_visto"].isoformat() if c["primeiro_visto"] else None,
            "ultimo_visto":   c["ultimo_visto"].isoformat()   if c["ultimo_visto"]   else None,
            "volume_posts": len(c["posts"]),
            "volume_coments": c["vol_coments"],
            "amplificacao": c["amplificacao"],
            "perfis_distintos": len(c["perfis"]),
            "queixa_top": queixa_top,
            "elogio_top": elogio_top,
            "comentario_top": c["comentario_top"],
            "comentario_top_curtidas": c["comentario_top_curtidas"],
            "status": _status_narrativa(c["ultimo_visto"]) if c["ultimo_visto"] else "ativa",
            "coordenacao_score": coord_score,
            "coordenacao_sinais": coord_sinais,
            "suspeitos_usernames": coord_susp,
            "atualizado_em": datetime.now().isoformat(),
        })

    # Atualiza comments com flag de suspeita (segundo upsert separado, leve)
    if suspeitos_globais:
        comments_susp = [
            {"id": cid, "suspeito_coordenacao": True, "motivo_suspeita": motivo}
            for cid, motivo in suspeitos_globais.items()
        ]
        _supabase_upsert("comments", comments_susp, "id")

    n = _supabase_upsert("narratives", rows, "id")
    ativas = sum(1 for r in rows if r["status"] == "ativa")
    log(f"  Narrativas gravadas: {n} ({ativas} ativas) | {len(grupos)} grupos coordenados | {len(suspeitos_globais)} coments suspeitos")


# ==============================================================
# MODULO 10 - DAILY_THEMES (Tendências por tema)
# ==============================================================

def gravar_daily_themes(posts_analisados):
    """Agrega volume + sentimento por (dia, tema). Base para a página Tendências."""
    if not SUPABASE_URL or not SUPABASE_KEY or not posts_analisados:
        return
    log("=== MODULO 10 - Daily Themes (Tendencias) ===")

    by_dia_tema = {}
    for p in posts_analisados:
        dia = _dia_iso(p.get("data_post", ""))
        tema = (p.get("tema") or "").strip().title()
        if not dia or not tema:
            continue
        k = (dia, tema)
        d = by_dia_tema.setdefault(k, {
            "posts": 0, "coments": 0, "curtidas": 0,
            "pos": 0, "neg": 0, "neu": 0, "risco_sum": 0,
        })
        d["posts"]    += 1
        d["coments"]  += int(p.get("total_coments", 0) or p.get("comentarios_total", 0) or 0)
        d["curtidas"] += int(p.get("curtidas", 0) or 0)
        d["risco_sum"] += int(p.get("score_risco", 0) or 0)
        s = _sent(p)
        if s == "positivo": d["pos"] += 1
        elif s == "negativo": d["neg"] += 1
        else: d["neu"] += 1

    rows = []
    for (dia, tema), d in by_dia_tema.items():
        tot = d["pos"] + d["neg"] + d["neu"] or 1
        rows.append({
            "tenant": TENANT, "dia": dia, "tema": tema,
            "volume_posts":   d["posts"],
            "volume_coments": d["coments"],
            "curtidas":       d["curtidas"],
            "pct_pos": round(d["pos"] / tot * 100, 1),
            "pct_neg": round(d["neg"] / tot * 100, 1),
            "pct_neu": round(d["neu"] / tot * 100, 1),
            "score_risco": round(d["risco_sum"] / d["posts"], 1) if d["posts"] else 0,
            "atualizado_em": datetime.now().isoformat(),
        })

    n = _supabase_upsert("daily_themes", rows, "tenant,dia,tema")
    log(f"  Daily themes: {n} (dia, tema) atualizados")

# ==============================================================
# MODULO 5b - BRIEFING DIARIO
# ==============================================================

def atualizar_briefing(planilha, posts_analisados, comentarios_por_post, alertas_enviados):
    log("=== MODULO 5b - Atualizando briefing ===")
    if not posts_analisados:
        log("  Nenhum post para resumir")
        return

    aba = garantir_aba(planilha, "Briefing_Diario", CABECALHO_BRIEFING)

    scores_img   = [p.get("score_imagem", 50) for p in posts_analisados]
    scores_risco = [p.get("score_risco", 0) for p in posts_analisados]
    score_medio_img   = round(sum(scores_img) / len(scores_img), 1)
    score_medio_risco = round(sum(scores_risco) / len(scores_risco), 1)

    temas = {}
    for p in posts_analisados:
        t = p.get("tema", "")
        if t: temas[t] = temas.get(t, 0) + 1
    narrativa = max(temas, key=temas.get) if temas else ""

    queixas = {}
    for p in posts_analisados:
        q = p.get("queixa_dominante", "")
        if q: queixas[q] = queixas.get(q, 0) + 1
    queixa_top = max(queixas, key=queixas.get) if queixas else ""

    perfis_c = {}
    for p in posts_analisados:
        a = p.get("autor", "")
        if a: perfis_c[a] = perfis_c.get(a, 0) + 1
    perfil_ativo = max(perfis_c, key=perfis_c.get) if perfis_c else ""

    urg_alta = sum(1 for p in posts_analisados if p.get("urgencia") == "alta")
    total_cid = sum(
        len([c for c in comentarios_por_post.get(p["url"], []) if c["tipo"] == "cidadao"])
        for p in posts_analisados
    )

    now = datetime.now()
    linha = [
        now.strftime("%d/%m/%Y"), now.strftime("%H:%M"),
        score_medio_img, score_medio_risco,
        len(posts_analisados), total_cid,
        narrativa, queixa_top, perfil_ativo, urg_alta, alertas_enviados,
    ]
    aba.append_row(linha, value_input_option="RAW")
    log(f"  Briefing gravado | Score imagem: {score_medio_img} | Risco: {score_medio_risco}")

# ==============================================================
# MODULO 6 - ALERTAS WHATSAPP
# ==============================================================

def formatar_mensagem_alerta(post):
    score_img = post.get("score_imagem", 50)
    emoji = "🔴" if score_img <= 20 else "🟠"
    msg = f"""{emoji} *ALERTA AGORA - Radar Politico Alagoinhas*

Perfil: @{post.get("autor","")} ({post.get("categoria","")})
Data: {post.get("data_post","")}
{post.get("url","")}

Score de Imagem: {score_img}/100
Score de Risco: {post.get("score_risco", 0)}/100

Queixa dominante:
{post.get("queixa_dominante", "Nao identificada")}

Comentario destaque:
"{post.get("comentarios_destaque", post.get("comentario_destaque", ""))}"

Sugestao de acao:
{post.get("sugestao_acao", "")}

Abordagem recomendada (SCCT):
{post.get("abordagem_recomendada", "") or "—"}

Por que alertou: {post.get("motivo_alerta", "") or f"Score imagem {post.get('score_imagem',0)} / risco {post.get('score_risco',0)}"}

Janela: {post.get("janela_acao", "")}

_Mensagem automatica do AGORA_"""
    return msg

def disparar_alertas(posts_analisados):
    log("=== MODULO 6 - Verificando alertas ===")
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        log("  Evolution API nao configurada - alertas desativados")
        return 0

    alertas_enviados = 0
    for post in posts_analisados:
        score_img   = post.get("score_imagem", 50)
        score_risco = post.get("score_risco", 0)
        dispara_por_imagem = score_img <= SCORE_IMAGEM_ALERTA
        dispara_por_risco  = deve_disparar_alerta(score_risco, post)
        if not dispara_por_imagem and not dispara_por_risco:
            continue
        # Garante que o motivo_alerta esta preenchido (calculado em analisar_com_agora)
        if not post.get("motivo_alerta") and dispara_por_risco:
            post["motivo_alerta"] = motivo_do_alerta(score_risco, post)

        log(f"  Alerta: @{post['autor']} | Imagem: {score_img} | Risco: {score_risco}")
        mensagem = formatar_mensagem_alerta(post)

        try:
            # Evolution API v2: 'text' no nivel raiz (mesmo formato do gerar_relatorio.py).
            r = requests.post(
                f"{EVOLUTION_URL}/message/sendText/{os.environ.get('EVOLUTION_INSTANCE','radar')}",
                headers={"Content-Type": "application/json", "apikey": EVOLUTION_KEY},
                json={"number": WHATSAPP_NUMBER, "text": mensagem},
                timeout=15
            )
            if r.status_code in (200, 201):
                log(f"    Alerta enviado")
                alertas_enviados += 1
            else:
                log(f"    Erro Evolution: {r.status_code} - {r.text[:200]}")
        except Exception as e:
            log(f"    Erro ao enviar: {e}")
        time.sleep(2)

    log(f"  {alertas_enviados} alertas enviados")
    return alertas_enviados

# ==============================================================
# MODULO 6b - UPDATE DE COMENTARIOS NOVOS
# ==============================================================

def enviar_update_coments(post, delta_coments):
    """Alerta resumido de novos comentarios em post de alto risco ja analisado."""
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        return
    log(f"  Update coments: @{post.get('autor','')} +{delta_coments} comentarios")
    msg = f"""🔔 *NOVOS COMENTARIOS - Radar Politico Alagoinhas*

Perfil: @{post.get("autor","")} ({post.get("categoria","")})
{post.get("url","")}

+{delta_coments} novos comentarios desde ultima analise
Score de Risco: {post.get("score_risco", 0)}/100

Comentario destaque:
"{post.get("comentarios_destaque", "")}"

Sugestao de acao: {post.get("sugestao_acao", "")}

_Mensagem automatica do AGORA_"""
    try:
        r = requests.post(
            f"{EVOLUTION_URL}/message/sendText/{os.environ.get('EVOLUTION_INSTANCE','radar')}",
            headers={"Content-Type": "application/json", "apikey": EVOLUTION_KEY},
            json={"number": WHATSAPP_NUMBER, "text": msg},
            timeout=15
        )
        if r.status_code in (200, 201):
            log(f"    Update enviado")
        else:
            log(f"    Erro update: {r.status_code}")
    except Exception as e:
        log(f"    Erro ao enviar update: {e}")


# ==============================================================
# MODULO 6c - BRIEFING MATINAL (WhatsApp 05h BRT)
# ==============================================================

def enviar_briefing_matinal(posts_analisados, briefing_ia):
    """Envia resumo executivo diario via WhatsApp (Evolution API).
    Chamado automaticamente na execucao das 05h BRT (08h UTC).
    """
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        log("  Briefing matinal: Evolution API nao configurada - pulando")
        return
    log("=== MODULO 6c - Briefing matinal WhatsApp ===")

    iad   = calc_iad(posts_analisados)
    ica   = calc_ica(posts_analisados)
    risco, nivel = calc_risco(posts_analisados, iad, ica)
    hoje = datetime.now().strftime("%d/%m/%Y")
    hora = datetime.now().strftime("%H:%M")

    emoji_nivel = {"baixo": "🟢", "moderado": "🟡", "alto": "🟠", "critico": "🔴"}.get(nivel, "⚪")

    # Temas com maior risco (top 3)
    temas = {}
    for p in posts_analisados:
        t = (p.get("tema") or "").strip()
        if t:
            temas[t] = max(temas.get(t, 0), int(p.get("score_risco", 0) or 0))
    top_temas = sorted(temas.items(), key=lambda x: -x[1])[:3]

    alertas = briefing_ia.get("alertas") or []
    recs    = briefing_ia.get("recomendacoes_comunicacao") or briefing_ia.get("recomendacoes") or []

    linhas = [
        "☀️ *BRIEFING MATINAL — Radar Político*",
        f"📅 {hoje} | {hora} BRT",
        "",
        "📊 *ÍNDICES*",
        f"• Aprovação Digital (IAD): {iad:.0f}/100",
        f"• Risco Político: {risco:.0f}/100 {emoji_nivel} {nivel.upper()}",
        f"• Confiança da Amostra (ICA): {ica:.0f}/100",
        "",
        "🔍 *DIAGNÓSTICO*",
        briefing_ia.get("diagnostico") or "Sem diagnóstico disponível.",
    ]

    if top_temas:
        linhas += ["", "📌 *TEMAS CRÍTICOS*"]
        for t, s in top_temas:
            linhas.append(f"• {t.capitalize()} (risco {s}/100)")

    if alertas:
        linhas += ["", "⚠️ *ALERTAS*"]
        for a in alertas[:3]:
            linhas.append(f"• [{a.get('nivel','')}] {a.get('tema','')} — {a.get('janela','')}")

    if recs:
        linhas += ["", "💡 *RECOMENDAÇÕES*"]
        for r in recs[:2]:
            canal = r.get("canal", "")
            msg_r = (r.get("mensagem") or "")[:130]
            linhas.append(f"• {canal}: \"{msg_r}\"")

    linhas += ["", "_Gerado automaticamente pelo AGORA_"]
    mensagem = "\n".join(linhas)

    try:
        r = requests.post(
            f"{EVOLUTION_URL}/message/sendText/{os.environ.get('EVOLUTION_INSTANCE','radar')}",
            headers={"Content-Type": "application/json", "apikey": EVOLUTION_KEY},
            json={"number": WHATSAPP_NUMBER, "text": mensagem},
            timeout=15,
        )
        if r.status_code in (200, 201):
            log("  Briefing matinal enviado via WhatsApp")
        else:
            log(f"  Briefing matinal: erro Evolution {r.status_code} — {r.text[:200]}")
    except Exception as e:
        log(f"  Briefing matinal: erro {e}")


# ==============================================================
# PIPELINE PRINCIPAL
# ==============================================================

# ==============================================================
# MODULO BOLETIM - BOLETIM CLIMATICO (Radar Comando)
# ==============================================================
# Traduz risco/IAD/SCCT para a metafora climatica do dashboard.
# Logica em boletim.py (puro, testavel); aqui so a coleta de dados
# e a gravacao. Roda DEPOIS de gravar_daily_metrics (precisa do
# risco de hoje ja persistido no historico).

def _frentes_por_tema(posts_analisados):
    """Agrupa posts por tema -> score = maior score_risco do tema."""
    por_tema = {}
    for p in posts_analisados:
        tema = str(p.get("tema", "") or "").strip()
        if not tema:
            continue
        sc = int(p.get("score_risco", 0) or 0)
        atual = por_tema.setdefault(tema, {"score": 0, "crescendo": False})
        atual["score"] = max(atual["score"], sc)
        if str(p.get("tendencia", "")).lower() == "crescendo":
            atual["crescendo"] = True
    frentes = []
    for tema, d in por_tema.items():
        tend = "subindo" if d["crescendo"] else ("caindo" if d["score"] < 30 else "estavel")
        frentes.append({"tema": tema, "score": float(d["score"]), "tendencia": tend})
    return frentes

def _origem_dominante(posts_analisados):
    """Categoria com mais comentarios no dia -> origem das 'rajadas'."""
    por_cat = {}
    for p in posts_analisados:
        cat = p.get("categoria", "Outros")
        por_cat[cat] = por_cat.get(cat, 0) + int(p.get("total_coments", 0) or 0)
    total = sum(por_cat.values()) or 1
    cat, n = max(por_cat.items(), key=lambda kv: kv[1]) if por_cat else ("-", 0)
    return cat, round(n / total * 100)

def gravar_boletim_climatico(posts_analisados):
    """Monta o boletim do dia e grava na tabela boletins (tenant, dia)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    log("=== MODULO BOLETIM - Boletim Climatico ===")

    # Historico de 30 dias do daily_metrics (mais recente primeiro)
    hist = _supabase_get(
        "daily_metrics",
        f"tenant=eq.{TENANT}&select=dia,risco,pct_neg,volume_coments&order=dia.desc&limit=30",
    ) or []
    if not hist:
        log("  Sem historico em daily_metrics; boletim adiado.")
        return
    hist_asc = list(reversed(hist))

    serie_7d = [float(r.get("risco", 0) or 0) for r in hist_asc[-7:]]
    risco_hoje = serie_7d[-1]

    # Termometro: pct_neg hoje vs ontem + media 30d
    neg_hoje  = int(hist_asc[-1].get("pct_neg", 0) or 0)
    neg_ontem = int(hist_asc[-2].get("pct_neg", 0) or 0) if len(hist_asc) >= 2 else neg_hoje
    media_30d = round(sum(int(r.get("pct_neg", 0) or 0) for r in hist_asc) / len(hist_asc))
    termometro = {"negativo_pct": neg_hoje, "delta_pp": neg_hoje - neg_ontem,
                  "media_30d": media_30d}

    # Rajadas: volume de comentarios hoje vs ontem + origem dominante
    vol_hoje  = int(hist_asc[-1].get("volume_coments", 0) or 0)
    vol_ontem = int(hist_asc[-2].get("volume_coments", 0) or 0) if len(hist_asc) >= 2 else vol_hoje
    delta_pct = round((vol_hoje - vol_ontem) / vol_ontem * 100) if vol_ontem else 0
    origem, origem_pct = _origem_dominante(posts_analisados)
    rajadas = {"mencoes_24h": vol_hoje, "delta_pct": delta_pct,
               "origem_dominante": origem, "origem_pct": origem_pct}

    # Alerta ativo: post de maior risco que dispararia alerta (score ou override)
    candidatos = [p for p in posts_analisados
                  if deve_disparar_alerta(int(p.get("score_risco", 0) or 0), p)]
    alerta_post = max(candidatos, key=lambda p: int(p.get("score_risco", 0) or 0)) \
        if candidatos else None
    if alerta_post and not alerta_post.get("motivo_alerta"):
        alerta_post["motivo_alerta"] = motivo_do_alerta(
            int(alerta_post.get("score_risco", 0) or 0), alerta_post)

    boletim = gerar_boletim(
        risco=risco_hoje,
        serie_7d=serie_7d,
        termometro=termometro,
        rajadas=rajadas,
        frentes=_frentes_por_tema(posts_analisados),
        alerta_post=alerta_post,
        override_resp_min=OVERRIDE_RESPONSABILIDADE_MIN,
    )

    dia = hist_asc[-1].get("dia") or datetime.now().strftime("%Y-%m-%d")
    n = _supabase_upsert("boletins", [{
        "tenant": TENANT,
        "dia": dia,
        "gerado_em": datetime.now().isoformat(),
        "boletim": boletim,
    }], "tenant,dia")
    log(f"  Boletim gravado ({boletim['condicao']}, nivel={boletim['nivel_cor']}): {n} registro")



def main():
    inicio = datetime.now()
    log("+======================================================+")
    log(f"|  AGORA iniciando - {inicio.strftime('%d/%m/%Y %H:%M:%S')}              |")
    log("+======================================================+")

    # Aviso crítico: sem Supabase, o dashboard (que lê o Postgres) NÃO atualiza.
    # Foi exatamente essa a causa do dashboard "congelar" rodando localmente.
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("  " + "!" * 54)
        log("  ! ATENCAO: SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.")
        log("  ! Os dados irao SOMENTE para o Google Sheets.")
        log("  ! O dashboard (Radar Comando) NAO sera atualizado!")
        log("  " + "!" * 54)

    log("  Conectando ao Google Sheets...")
    planilha = conectar_sheets()
    log(f"  Conectado: {planilha.title}")

    # Carrega URLs ja analisados com contagem de comentarios (para filtrar alertas repetidos)
    existentes_radar = {}  # url -> total_coments gravados
    try:
        aba_r = garantir_aba(planilha, "Radar", CABECALHO_RADAR)
        for r in aba_r.get_all_records():
            u = r.get("url", "")
            if u:
                existentes_radar[u] = int(r.get("comentarios_total", 0) or 0)
        log(f"  {len(existentes_radar)} posts ja analisados carregados")
    except Exception as e:
        log(f"  Aviso: nao foi possivel carregar existentes ({e})")

    posts = coletar_posts()
    if not posts:
        log("  Nenhum post coletado. Pipeline encerrado.")
        return

    comentarios_por_post = coletar_comentarios(posts)
    memoria = carregar_memoria(planilha)
    posts_analisados = analisar_com_agora(posts, comentarios_por_post, memoria)
    # Sheets é legado e tem cota de escrita/min (erro 429). NÃO pode derrubar o
    # dual-write do Supabase, que é o que alimenta o dashboard (Radar Comando).
    try:
        novos_radar, novos_coments = gravar_no_sheets(planilha, posts_analisados, comentarios_por_post)
    except Exception as e:
        log(f"  Sheets FALHOU ({e}) — seguindo; o dashboard usa o Supabase")
        novos_radar, novos_coments = 0, 0
    # Cada etapa secundaria roda isolada (_safe): se uma falhar, as demais e os
    # ALERTAS (saida mais critica, por ultimo) continuam.
    _safe("creditos_apify", verificar_creditos_apify)                               # alerta quando creditos > 80%
    _safe("supabase", gravar_no_supabase, posts_analisados, comentarios_por_post)  # dual-write -> dashboard
    _safe("daily_metrics", gravar_daily_metrics, posts_analisados)                 # historico de indices (Fase 3)
    _safe("boletim_climatico", gravar_boletim_climatico, posts_analisados)         # boletim climatico (Radar Comando)
    briefing_ia = _safe("briefing_estrategico", gerar_briefing_estrategico, posts_analisados)  # assistente IA (Fase 3d)
    # Briefing matinal: run das 05h BRT (08h UTC) — aceita 8 ou 9 UTC p/ tolerar
    # atraso do cron do GitHub Actions. Forcar com BRIEFING_MATINAL=true.
    hora_utc = datetime.utcnow().hour
    if briefing_ia and (hora_utc in (8, 9) or os.environ.get("BRIEFING_MATINAL", "").lower() == "true"):
        _safe("briefing_matinal", enviar_briefing_matinal, posts_analisados, briefing_ia)
    _safe("cacador_crises", rodar_cacador_crises, posts_analisados, comentarios_por_post)  # agente caçador de crises (Fase B)
    _safe("influencers", gravar_influencers, posts_analisados, comentarios_por_post)       # ranking de influenciadores
    _safe("narratives", gravar_narratives, posts_analisados, comentarios_por_post)         # narrativas (tema + sentimento)
    _safe("daily_themes", gravar_daily_themes, posts_analisados)                           # tendencias por tema (Fase 3e)
    _safe("alertas_limiar", verificar_alertas, posts_analisados)                           # alertas por limiar (Sprint 2)
    # Apenas posts NOVOS recebem alerta; posts existentes com muitos novos comentarios recebem update
    posts_novos = [p for p in posts_analisados if p.get("url") not in existentes_radar]
    posts_com_update = [
        p for p in posts_analisados
        if p.get("url") in existentes_radar
        and p.get("score_risco", 0) >= SCORE_RISCO_ALERTA
        and (p.get("total_coments", 0) - existentes_radar.get(p.get("url", ""), 0)) >= 5
    ]
    alertas = disparar_alertas(posts_novos)
    for p in posts_com_update:
        delta = p.get("total_coments", 0) - existentes_radar.get(p.get("url", ""), 0)
        enviar_update_coments(p, delta)
    try:
        atualizar_briefing(planilha, posts_analisados, comentarios_por_post, alertas)
    except Exception as e:
        log(f"  Briefing no Sheets falhou ({e}) — ignorado (nao afeta o dashboard)")

    fim = datetime.now()
    duracao = (fim - inicio).seconds
    log("")
    log("+======================================================+")
    log(f"|  AGORA concluido                                      |")
    log(f"|  Posts coletados:    {len(posts):<4}                          |")
    log(f"|  Posts analisados:   {len(posts_analisados):<4}                          |")
    log(f"|  Comentarios novos:  {novos_coments:<4}                          |")
    log(f"|  Alertas enviados:   {alertas:<4}                          |")
    log(f"|  Duracao:            {duracao}s                           |")
    log("+======================================================+")

def main_multi_tenant():
    """Itera por todos os tenants ativos no Supabase.
    Fallback: modo single-tenant legado se a tabela 'tenants' não existir."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        main()
        return

    tenants_ativos = _supabase_get(
        "tenants", "ativo=eq.true&select=tenant_id,municipio,estado,perfis_json"
    )

    if not tenants_ativos:
        log("  Tabela 'tenants' vazia ou ausente — modo single-tenant.")
        main()
        return

    log("+======================================================+")
    log(f"|  AGORA Multi-Tenant: {len(tenants_ativos)} tenant(s) ativo(s)       |")
    log("+======================================================+")

    global TENANT, PERFIS
    for t in tenants_ativos:
        tid = t.get("tenant_id", TENANT)
        municipio = t.get("municipio", tid)
        perfis_json = t.get("perfis_json")

        TENANT = tid
        if isinstance(perfis_json, dict) and perfis_json:
            PERFIS.clear()
            PERFIS.update(perfis_json)

        log(f"\n=== TENANT: {tid} ({municipio} / {t.get('estado', '')}) ===")
        try:
            main()
        except Exception as e:
            log(f"  ERRO no tenant {tid}: {e}")


def teste_filtro():
    """Busca os últimos 5 posts do dataset Apify mais recente e testa o filtro de relevância."""
    import sys as _sys

    if not APIFY_TOKEN:
        print("[teste-filtro] APIFY_API_TOKEN não configurado.")
        _sys.exit(1)

    # Keywords em uso
    if _keywords_banco:
        print(f"[keywords] Supabase: {len(_keywords_banco)} keywords → {_keywords_banco}")
    else:
        print(f"[keywords] Fallback — governo:{KEYWORDS_GOVERNO} | oposicao:{KEYWORDS_OPOSICAO} | imprensa:{KEYWORDS_IMPRENSA}")

    # Busca o run mais recente do actor de posts
    print(f"\n[teste-filtro] Buscando último run do actor {ACTOR_POSTS}…")
    url = f"{APIFY_BASE}/acts/{ACTOR_POSTS}/runs/last"
    r = requests.get(url, params={"token": APIFY_TOKEN, "status": "SUCCEEDED"}, timeout=15)
    if r.status_code != 200:
        print(f"[teste-filtro] Erro ao buscar último run: {r.status_code} {r.text[:200]}")
        _sys.exit(1)

    dataset_id = r.json().get("data", {}).get("defaultDatasetId")
    if not dataset_id:
        print("[teste-filtro] Nenhum dataset encontrado no último run.")
        _sys.exit(1)

    print(f"[teste-filtro] Dataset: {dataset_id}")
    posts = apify_buscar_resultados(dataset_id, limit=5)
    if not posts:
        print("[teste-filtro] Dataset vazio.")
        _sys.exit(1)

    print(f"\n[teste-filtro] {len(posts)} posts brutos — testando filtro de relevância:\n")
    for i, p in enumerate(posts, 1):
        handle   = extrair(p, "ownerUsername", "username", "owner", padrao="(desconhecido)").lower()
        caption  = extrair_caption(extrair(p, "caption", "text", "description"))
        info     = PERFIS.get(handle, {"categoria": "Desconhecido", "filtro": "governo"})
        filtro   = info["filtro"]

        if filtro == "governo":
            passou = True
            motivo = "governo — sem filtro de relevância aplicado"
        else:
            kws = KEYWORDS_OPOSICAO if filtro == "oposicao" else KEYWORDS_IMPRENSA
            match = next((kw for kw in kws if kw in caption.lower()), None)
            passou = match is not None
            motivo = f"keyword '{match}' encontrada" if passou else f"nenhuma keyword bateu (lista={kws})"

        status = "✔ PASSOU" if passou else "✘ DESCARTADO"
        print(f"  [{i}] @{handle} ({filtro}) → {status}")
        print(f"       motivo : {motivo}")
        print(f"       caption: {caption[:300]!r}")
        print()


if __name__ == "__main__":
    import sys
    if "--multi-tenant" in sys.argv:
        main_multi_tenant()
    elif "--teste-filtro" in sys.argv:
        teste_filtro()
    else:
        main()
