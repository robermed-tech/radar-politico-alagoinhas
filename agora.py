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
import json
import time
import math
import requests
from datetime import datetime, timedelta
from anthropic import Anthropic
import gspread
from google.oauth2.service_account import Credentials

# ==============================================================
# CONFIGURACAO
# ==============================================================

APIFY_TOKEN      = os.environ["APIFY_API_TOKEN"]
ANTHROPIC_KEY    = os.environ["ANTHROPIC_API_KEY"]
SPREADSHEET_ID   = os.environ["SPREADSHEET_ID"]
EVOLUTION_URL    = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_KEY    = os.environ.get("EVOLUTION_API_KEY", "")
WHATSAPP_NUMBER  = os.environ.get("WHATSAPP_NUMBER", "")
# Supabase (Fase 2 — dual-write). Se vazio, o dual-write é ignorado (Sheets segue normal).
SUPABASE_URL     = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY     = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT           = os.environ.get("RADAR_TENANT", "alagoinhas")

APIFY_BASE = "https://api.apify.com/v2"

# Actor IDs (nomes oficiais do Apify Store)
ACTOR_POSTS    = "apify~instagram-post-scraper"
ACTOR_COMMENTS = "apify~instagram-comment-scraper"

# Perfis monitorados - 14 perfis em 3 categorias
PERFIS = {
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

# Palavras-chave de relevancia por filtro
KEYWORDS_GOVERNO  = ["prefeitura", "prefeito", "gustavo", "gestao", "alagoinhas",
                     "obra", "servico", "municipal", "secretaria", "secom"]
KEYWORDS_OPOSICAO = ["prefeitura", "prefeito", "gustavo carmo", "gestao municipal",
                     "alagoinhas", "administracao"]
KEYWORDS_IMPRENSA = ["prefeitura de alagoinhas", "gustavo carmo", "gestao municipal",
                     "prefeito de alagoinhas"]

# Score de alerta
SCORE_IMAGEM_ALERTA = 30
SCORE_RISCO_ALERTA  = 70

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

# ==============================================================
# MODULO 1 - COLETA DE POSTS VIA APIFY
# ==============================================================

def coletar_posts():
    """
    Coleta posts dos 14 perfis via Apify Instagram Post Scraper.
    Envia todos os perfis de uma vez (mais eficiente).
    """
    log("=== MODULO 1 - Coletando posts via Apify ===")

    # Monta URLs dos perfis
    usernames = [f"https://www.instagram.com/{handle}/"
                   for handle in PERFIS.keys()]

    input_data = {
        "username": usernames,
        "resultsLimit": MAX_POSTS_POR_PERFIL,
    }

    log(f"  Enviando {len(usernames)} perfis para o Apify...")
    run_id = apify_iniciar_run(ACTOR_POSTS, input_data)
    if not run_id:
        log("  Falha ao iniciar coleta de posts")
        return []

    dataset_id = apify_aguardar_run(run_id, timeout=300)
    if not dataset_id:
        return []

    resultados_brutos = apify_buscar_resultados(dataset_id)
    log(f"  {len(resultados_brutos)} posts brutos retornados")

    # Normaliza e filtra os posts
    todos_posts = []
    for p in resultados_brutos:
        # Extrai username do post
        handle = extrair(p, "ownerUsername", "username", "owner", padrao="").lower()
        if handle not in PERFIS:
            continue

        info = PERFIS[handle]
        categoria = info["categoria"]
        filtro    = info["filtro"]

        # URL
        url = extrair(p, "url", "postUrl", "permalink", "webLink")
        if not url:
            shortcode = extrair(p, "shortCode", "shortcode", "code")
            url = f"https://www.instagram.com/p/{shortcode}/" if shortcode else ""
        if not url:
            continue

        # Caption
        caption = extrair_caption(extrair(p, "caption", "text", "description"))

        # Data
        ts_raw = extrair(p, "timestamp", "taken_at", "takenAt", "date")
        data_post = timestamp_para_data(ts_raw)

        # Filtro de periodo
        if not dentro_do_periodo(data_post):
            continue

        # Filtro de relevancia (oposicao/imprensa precisam mencionar prefeito)
        if filtro != "governo" and not filtrar_relevante(caption, filtro):
            continue

        post = {
            "url":            url,
            "autor":          handle,
            "categoria":      categoria,
            "data_post":      data_post,
            "curtidas":       int(extrair(p, "likesCount", "likes", "like_count", padrao=0)),
            "total_coments":  int(extrair(p, "commentsCount", "comments", "comment_count", padrao=0)),
            "caption":        caption[:500],
            "shortcode":      extrair(p, "shortCode", "shortcode", "code", padrao=""),
        }
        todos_posts.append(post)

    log(f"  Total filtrado: {len(todos_posts)} posts relevantes")
    return todos_posts

# ==============================================================
# MODULO 2 - COLETA DE COMENTARIOS VIA APIFY
# ==============================================================

def coletar_comentarios(posts):
    """
    Coleta comentarios de todos os posts via Apify Instagram Comment Scraper.
    Envia todas as URLs de uma vez (batch eficiente).
    """
    log("=== MODULO 2 - Coletando comentarios via Apify ===")
    handles_monitorados = set(PERFIS.keys())

    # Filtra posts que tem comentarios
    posts_com_coments = [p for p in posts if p["total_coments"] > 0]
    if not posts_com_coments:
        log("  Nenhum post com comentarios para coletar")
        return {p["url"]: [] for p in posts}

    urls_posts = [p["url"] for p in posts_com_coments]
    log(f"  Enviando {len(urls_posts)} posts para coleta de comentarios...")

    input_data = {
        "directUrls": urls_posts,
        "resultsLimit": MAX_COMENTARIOS_POR_POST,
    }

    run_id = apify_iniciar_run(ACTOR_COMMENTS, input_data)
    if not run_id:
        log("  Falha ao iniciar coleta de comentarios")
        return {p["url"]: [] for p in posts}

    dataset_id = apify_aguardar_run(run_id, timeout=300)
    if not dataset_id:
        return {p["url"]: [] for p in posts}

    resultados_brutos = apify_buscar_resultados(dataset_id, limit=2000)
    log(f"  {len(resultados_brutos)} comentarios brutos retornados")

    # Agrupa comentarios por post URL
    resultado = {p["url"]: [] for p in posts}

    for c in resultados_brutos:
        if not isinstance(c, dict):
            continue

        texto = extrair(c, "text", "comment", "content", padrao="").strip()
        if len(texto.split()) < 3:
            continue  # filtra bots/emojis

        # Identifica o post de origem
        post_url = extrair(c, "postUrl", "inputUrl", "url", padrao="")

        # Se nao encontrou por campo direto, tenta pelo shortcode
        if post_url not in resultado:
            for url_key in resultado:
                if any(sc in url_key for sc in [extrair(c, "shortCode", "postShortCode", padrao="XXX")]):
                    post_url = url_key
                    break

        if post_url not in resultado:
            # Associa ao primeiro post disponivel se nao conseguir mapear
            if posts_com_coments:
                post_url = posts_com_coments[0]["url"]

        username = extrair(c, "ownerUsername", "username", "author", padrao="")
        tipo = "politico" if username.lower() in handles_monitorados else "cidadao"

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

    # Log resumo
    total_c = sum(len(v) for v in resultado.values())
    posts_com = sum(1 for v in resultado.values() if v)
    log(f"  {total_c} comentarios processados de {posts_com} posts")
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

PROMPT_SISTEMA = """Voce e o AGORA, agente de inteligencia politica especializado em monitorar
a imagem publica do prefeito Gustavo Carmo e da Prefeitura de Alagoinhas/BA.

Seu objetivo principal e analisar os COMENTARIOS dos cidadaos nos posts do Instagram,
pois a reacao do cidadao comum e o verdadeiro termometro da imagem do prefeito.
O post e apenas o gatilho - o que importa e o que o povo respondeu.

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

    coments_txt = ""
    if cidadaos_sorted:
        coments_txt += f"\nCOMENTARIOS DE CIDADAOS ({len(cidadaos_sorted)} total):\n"
        for c in cidadaos_sorted[:20]:
            coments_txt += f'  {c["curtidas"]} curtidas @{c["username"]}: "{c["texto"]}"\n'
    if politicos:
        coments_txt += f"\nCOMENTARIOS DE PERFIS POLITICOS ({len(politicos)} total):\n"
        for c in politicos[:5]:
            coments_txt += f'  @{c["username"]}: "{c["texto"]}"\n'

    prompt = f"""
{memoria}

POST PARA ANALISE
Perfil: @{post["autor"]} ({post["categoria"]})
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
  "sentimento_post": "<positivo|negativo|neutro>",
  "sentimento_comentarios": "<positivo|negativo|neutro|misto>",
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
  "janela_acao": "<imediato|24h|esta semana>"
}}"""
    return prompt

def analisar_com_agora(posts, comentarios_por_post, memoria):
    log("=== MODULO 4 - Analisando com o AGORA ===")
    cliente = Anthropic(api_key=ANTHROPIC_KEY)
    resultado = []

    for i, post in enumerate(posts, 1):
        url = post["url"]
        comentarios = comentarios_por_post.get(url, [])
        log(f"  [{i}/{len(posts)}] @{post['autor']} | {len(comentarios)} comentarios")

        prompt = montar_prompt(post, comentarios, memoria)

        try:
            resposta = cliente.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1000,
                system=PROMPT_SISTEMA,
                messages=[{"role": "user", "content": prompt}]
            )
            texto = resposta.content[0].text.strip()

            if texto.startswith("```"):
                texto = texto.split("```")[1]
                if texto.startswith("json"):
                    texto = texto[4:]
            texto = texto.strip()

            analise = json.loads(texto)
            post_enriquecido = {**post, **analise}
            post_enriquecido["total_cidadaos"]  = len([c for c in comentarios if c["tipo"] == "cidadao"])
            post_enriquecido["total_politicos"] = len([c for c in comentarios if c["tipo"] == "politico"])
            resultado.append(post_enriquecido)

            score_img = analise.get("score_imagem", 50)
            score_risco = analise.get("score_risco", 0)
            log(f"    Score imagem: {score_img} | Risco: {score_risco} | {analise.get('sentimento_comentarios','')}")

        except json.JSONDecodeError as e:
            log(f"    JSON invalido: {e}")
            resultado.append({**post, "score_imagem": 50, "score_risco": 0,
                              "risco_crise": "baixo", "tendencia": "estavel",
                              "atribuicao": "outros", "resumo": "",
                              "comentarios_pct_pos": 0, "comentarios_pct_neg": 0,
                              "comentarios_destaque": "", "comentarios_destaque_curtidas": 0, "comentarios_destaque_autor": "",
                              "urgencia": "baixa", "tema": "",
                              "sentimento_post": "neutro", "sentimento_comentarios": "neutro"})
        except Exception as e:
            log(f"    Erro AGORA: {e}")
            resultado.append({**post, "score_imagem": 50, "score_risco": 0,
                              "risco_crise": "baixo", "tendencia": "estavel",
                              "atribuicao": "outros", "resumo": "",
                              "comentarios_pct_pos": 0, "comentarios_pct_neg": 0,
                              "comentarios_destaque": "", "comentarios_destaque_curtidas": 0, "comentarios_destaque_autor": "",
                              "urgencia": "baixa", "tema": "",
                              "sentimento_post": "neutro", "sentimento_comentarios": "neutro"})

        time.sleep(1)

    log(f"  {len(resultado)} posts analisados pelo AGORA")
    return resultado

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
    "caption", "atualizado_em"
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

    novos_radar = 0
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
        ]
        aba_radar.append_row(linha, value_input_option="RAW")
        existentes.add(p["url"])
        novos_radar += 1

    log(f"  Radar: {novos_radar} posts novos gravados")

    # Aba Comentarios_Analisados
    aba_coments = garantir_aba(planilha, "Comentarios_Analisados", CABECALHO_COMENTARIOS)
    ids_existentes = set()
    try:
        todas_c = aba_coments.get_all_records()
        ids_existentes = {str(r.get("comentario_id", "")) for r in todas_c}
    except Exception:
        pass

    novos_coments = 0
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
            aba_coments.append_row(linha_c, value_input_option="RAW")
            if cid:
                ids_existentes.add(cid)
            novos_coments += 1

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

def gravar_no_supabase(posts_analisados, comentarios_por_post):
    """Espelha os dados no Postgres do Supabase. Sheets continua como fonte da verdade."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("  Supabase nao configurado - dual-write ignorado")
        return
    log("=== MODULO 5c - Dual-write Supabase ===")
    agora = datetime.now().isoformat()

    posts_rows = []
    for p in posts_analisados:
        if not p.get("url"):
            continue
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
            "comentarios_pct_pos": float(p.get("comentarios_pct_pos", 0) or 0),
            "comentarios_pct_neg": float(p.get("comentarios_pct_neg", 0) or 0),
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
        if score_img > SCORE_IMAGEM_ALERTA and score_risco < SCORE_RISCO_ALERTA:
            continue

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
# PIPELINE PRINCIPAL
# ==============================================================

def main():
    inicio = datetime.now()
    log("+======================================================+")
    log(f"|  AGORA iniciando - {inicio.strftime('%d/%m/%Y %H:%M:%S')}              |")
    log("+======================================================+")

    log("  Conectando ao Google Sheets...")
    planilha = conectar_sheets()
    log(f"  Conectado: {planilha.title}")

    posts = coletar_posts()
    if not posts:
        log("  Nenhum post coletado. Pipeline encerrado.")
        return

    comentarios_por_post = coletar_comentarios(posts)
    memoria = carregar_memoria(planilha)
    posts_analisados = analisar_com_agora(posts, comentarios_por_post, memoria)
    novos_radar, novos_coments = gravar_no_sheets(planilha, posts_analisados, comentarios_por_post)
    gravar_no_supabase(posts_analisados, comentarios_por_post)  # dual-write (opcional)
    gravar_daily_metrics(posts_analisados)                       # historico de indices (Fase 3)
    alertas = disparar_alertas(posts_analisados)
    atualizar_briefing(planilha, posts_analisados, comentarios_por_post, alertas)

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

if __name__ == "__main__":
    main()
