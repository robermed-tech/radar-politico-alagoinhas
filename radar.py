import os
import re
import json
import sys
import time
import requests
import gspread
import anthropic
from datetime import datetime
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

# ── Credenciais e configurações de API (via .env) ────────────────────────────
APIFY_API_TOKEN             = os.environ["APIFY_API_TOKEN"]
APIFY_POST_ACTOR_ID         = os.environ.get("APIFY_POST_ACTOR_ID", "apify/instagram-post-scraper")
APIFY_COMMENT_ACTOR_ID      = os.environ.get("APIFY_COMMENT_ACTOR_ID", "apify/instagram-comment-scraper")
ANTHROPIC_API_KEY           = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
GOOGLE_SHEET_ID             = os.environ["GOOGLE_SHEET_ID"]
GOOGLE_SHEET_NAME           = os.environ.get("GOOGLE_SHEET_NAME", "Radar")


# ── Config do cliente (via CLIENT_CONFIG no .env) ─────────────────────────────

def _carregar_config():
    """Lê o arquivo JSON do cliente apontado por CLIENT_CONFIG no .env."""
    config_path = os.environ.get("CLIENT_CONFIG", "clientes/template.json")
    if not os.path.isfile(config_path):
        raise FileNotFoundError(
            f"Arquivo de config não encontrado: {config_path}\n"
            f"Defina CLIENT_CONFIG no .env apontando para um JSON em clientes/."
        )
    with open(config_path, encoding="utf-8") as f:
        return json.load(f)


_CFG = _carregar_config()

# Dados do cliente carregados do JSON
NOME_CLIENTE       = _CFG["nome"]           # ex: "Alagoinhas/BA"
PERFIS_CATEGORIAS  = _CFG["perfis"]         # dict username -> categoria
PERFIS_GESTAO      = set(_CFG["perfis_gestao"])
KEYWORDS           = _CFG["keywords"]
KEYWORDS_ANCORA    = _CFG["keywords_ancora"]
KEYWORDS_GESTAO    = _CFG["keywords_gestao"]
KEYWORDS_CONTEXTO  = _CFG["keywords_contexto"]

# Derivados
PERFIS        = list(PERFIS_CATEGORIAS.keys())
PROFILES_META = PERFIS_CATEGORIAS   # alias usado por run_pipeline.py


# ── Colunas da planilha ───────────────────────────────────────────────────────
SHEET_HEADERS = [
    "url", "data_post", "autor", "categoria_perfil",
    "curtidas", "comentarios_count",
    "sentimento_post", "sentimento_comentarios",
    "comentarios_negativos_pct", "comentarios_positivos_pct",
    "total_comentarios", "comentaristas",
    "comentarios_positivos_texto", "comentarios_negativos_texto", "comentarios_destaque",
    "tema", "tema_sensivel", "urgencia",
    "risco_crise", "tendencia", "engajamento",
    "resumo", "atribuicao", "sugestao_acao"
]

# ── Prompt de análise (usa nome do cliente dinamicamente) ─────────────────────
ANALYSIS_PROMPT = """\
Você é um analista político sênior da Prefeitura de {nome_cliente}, especializado em monitoramento de redes sociais e gestão de crises de comunicação.

Analise o post e os comentários abaixo com profundidade estratégica e retorne SOMENTE um JSON válido, sem texto extra, sem markdown.

Post (publicado por: {autor} — categoria: {categoria}):
{texto}

Comentários ({total} comentários de: {comentaristas}):
{comentarios}

Retorne exatamente este JSON:
{{
  "sentimento_post": "Positivo" | "Negativo" | "Neutro",
  "sentimento_comentarios": "Positivo" | "Negativo" | "Neutro" | "Sem comentários",
  "comentarios_negativos_pct": "<percentual estimado, ex: 35%>",
  "comentarios_positivos_pct": "<percentual estimado, ex: 45%>",
  "comentarios_positivos_texto": "<até 3 comentários positivos representativos, separados por | >",
  "comentarios_negativos_texto": "<até 3 comentários negativos representativos, separados por | >",
  "comentarios_destaque": "<o comentário mais relevante/impactante do ponto de vista político>",
  "tema": "Saúde" | "Obras" | "Educação" | "Segurança" | "Política" | "Social" | "Transporte" | "Meio Ambiente" | "Outro",
  "tema_sensivel": "Sim" | "Não",
  "urgencia": "Alta" | "Média" | "Baixa",
  "risco_crise": "Alto" | "Médio" | "Baixo",
  "tendencia": "Crescendo" | "Estável" | "Diminuindo",
  "engajamento": "Alto" | "Médio" | "Baixo",
  "resumo": "<resumo objetivo do post em até 15 palavras>",
  "atribuicao": "<a quem o post se refere, ex: Prefeitura, Oposição, Câmara Municipal>",
  "sugestao_acao": "Monitorar" | "Responder publicamente" | "Acionar assessoria" | "Conter crise" | "Ampliar positivo"
}}

Critérios importantes:
- "tema_sensivel": marque Sim quando o tema pode gerar repercussão negativa ampla
- "risco_crise": Alto quando há comentários negativos crescentes + tema sensível + urgência alta
- "tendencia": avalie se o tom dos comentários está piorando, estável ou melhorando
- "engajamento": Alto acima de 50 comentários/curtidas, Médio entre 10-50, Baixo abaixo de 10
- "sugestao_acao": baseie na combinação de sentimento + risco + tendência
- "comentarios_positivos_texto" e "comentarios_negativos_texto": transcreva trechos reais dos comentários
- Se não houver comentários de determinado sentimento, retorne string vazia ""
- "comentaristas": liste os usernames mais ativos nos comentários"""


# ── Utilitários ───────────────────────────────────────────────────────────────

def limpar_texto(texto):
    if not texto:
        return "sem texto"
    texto = re.sub(r"http\S+", "", texto)
    texto = re.sub(r"[^\w\s\.,!?;:\-áéíóúàâêôãõüçÁÉÍÓÚÀÂÊÔÃÕÜÇ@]", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto or "sem texto"


def tem_keyword(texto):
    t = texto.lower()
    return any(k in t for k in KEYWORDS)


def formatar_data(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return ts or ""


def categoria_perfil(autor):
    return PERFIS_CATEGORIAS.get(autor.lower(), "Outro")


def e_relevante_para_radar(texto, autor):
    """
    Filtro de relevância em três camadas:
    1. Perfis da gestão: qualquer keyword de gestão passa
    2. Outros perfis com âncora local: qualquer keyword de gestão aprova
    3. Outros perfis com âncora local + tema municipal: keyword de contexto aprovam
    """
    t = texto.lower()

    # Camada 1 — perfis da própria gestão (filtro mais permissivo)
    if autor.lower() in PERFIS_GESTAO:
        return any(k in t for k in KEYWORDS_GESTAO)

    # Camada 2 — outros perfis precisam de âncora local
    tem_ancora = any(k in t for k in KEYWORDS_ANCORA)
    if not tem_ancora:
        return False

    # Camada 3 — com âncora: keyword de gestão OU contexto municipal aprova
    tem_gestao  = any(k in t for k in KEYWORDS_GESTAO)
    tem_contexto = any(k in t for k in KEYWORDS_CONTEXTO)
    return tem_gestao or tem_contexto


# ── Apify ─────────────────────────────────────────────────────────────────────

def disparar_actor(actor_id, input_data, timeout=300):
    print(f"  Disparando {actor_id}...")
    actor_slug = actor_id.replace("/", "~")
    url = f"https://api.apify.com/v2/acts/{actor_slug}/runs?token={APIFY_API_TOKEN}"
    resp = requests.post(url, json=input_data, timeout=30)
    resp.raise_for_status()
    run = resp.json()["data"]
    run_id = run["id"]
    print(f"  Run iniciado: {run_id}")

    inicio = time.time()
    while True:
        time.sleep(10)
        status_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={APIFY_API_TOKEN}"
        r = requests.get(status_url, timeout=15)
        r.raise_for_status()
        status = r.json()["data"]["status"]
        print(f"  Status: {status}")

        if status == "SUCCEEDED":
            dataset_id = r.json()["data"]["defaultDatasetId"]
            print(f"  Dataset ID: {dataset_id}")
            return dataset_id

        if status in ("FAILED", "ABORTED", "TIMED-OUT"):
            raise RuntimeError(f"Actor {actor_id} terminou com status: {status}")

        if time.time() - inicio > timeout:
            raise TimeoutError(f"Actor {actor_id} excedeu {timeout}s de espera.")


def buscar_items(dataset_id):
    url = (
        f"https://api.apify.com/v2/datasets/{dataset_id}/items"
        f"?token={APIFY_API_TOKEN}&format=json&clean=true"
    )
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


# ── Google Sheets ─────────────────────────────────────────────────────────────

def abrir_planilha():
    creds = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(GOOGLE_SHEET_ID)
    try:
        ws = sh.worksheet(GOOGLE_SHEET_NAME)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(GOOGLE_SHEET_NAME, rows=1000, cols=25)

    # Garante cabeçalho atualizado
    cabecalho_atual = ws.row_values(1)
    if cabecalho_atual != SHEET_HEADERS:
        ws.clear()
        ws.append_row(SHEET_HEADERS)

    return ws


def urls_existentes(ws):
    valores = ws.col_values(1)
    return set(valores[1:])


# ── Claude API ────────────────────────────────────────────────────────────────

def analisar_post(texto, comentarios_lista, autor, categoria):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    total = len(comentarios_lista)
    comentaristas = ", ".join(set(
        c.split(":")[0].strip() for c in comentarios_lista[:20] if ":" in c
    )) or "nenhum"

    comentarios_texto = "\n".join(
        f"- {c}" for c in comentarios_lista
    ) if comentarios_lista else "Sem comentários coletados."

    prompt = ANALYSIS_PROMPT.format(
        nome_cliente=NOME_CLIENTE,
        texto=texto,
        autor=autor,
        categoria=categoria,
        total=total,
        comentaristas=comentaristas,
        comentarios=comentarios_texto,
    )

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=900,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r"```(?:json)?|```", "", raw).strip()
    return json.loads(raw)


# ── Coleta de comentários ─────────────────────────────────────────────────────

def coletar_comentarios(urls_posts):
    if not urls_posts:
        return {}

    print(f"\n  Coletando comentários de {len(urls_posts)} posts...")

    input_data = {
        "directUrls": urls_posts,
        "resultsLimit": 500,
        "includeReplies": True,
    }

    try:
        dataset_id = disparar_actor(APIFY_COMMENT_ACTOR_ID, input_data, timeout=300)
        items = buscar_items(dataset_id)
    except Exception as e:
        print(f"  Aviso: falha ao coletar comentários — {e}")
        return {}

    # Agrupa por URL, filtrando apenas comentários politicamente relevantes
    mapa = {}
    ignorados = 0
    for item in items:
        post_url = (item.get("postUrl") or item.get("url") or "").rstrip("/")
        texto    = item.get("text") or item.get("comment") or ""
        username = item.get("ownerUsername") or item.get("username") or "anon"
        if not post_url or not texto:
            continue
        texto_limpo = limpar_texto(texto)
        tem_conteudo = len(texto_limpo) > 10
        tem_politica = any(k in texto_limpo.lower() for k in KEYWORDS_CONTEXTO)
        if tem_politica or (tem_conteudo and tem_keyword(texto_limpo)):
            entrada = f"{username}: {texto_limpo}"
            mapa.setdefault(post_url, []).append(entrada)
        else:
            ignorados += 1

    total_coletados = sum(len(v) for v in mapa.values())
    print(f"  {len(items)} brutos -> {total_coletados} relevantes em {len(mapa)} posts ({ignorados} ignorados).")
    return mapa


# ── Pipeline principal ────────────────────────────────────────────────────────

def processar():
    print("=" * 60)
    print(f"RADAR POLÍTICO — {NOME_CLIENTE}")
    print("=" * 60)

    # 1. Coleta posts
    print("\n[1/5] Coletando posts do Instagram...")
    post_input = {
        "username": PERFIS,
        "resultsLimit": 20,
        "onlyPostsNewerThan": "1 day",
        "skipPinnedPosts": False,
    }
    try:
        post_dataset_id = disparar_actor(APIFY_POST_ACTOR_ID, post_input, timeout=300)
        posts = buscar_items(post_dataset_id)
    except Exception as e:
        print(f"Erro ao coletar posts: {e}")
        sys.exit(1)

    print(f"  {len(posts)} posts recebidos.")
    if not posts:
        print("Nenhum post encontrado. Encerrando.")
        return

    # 2. Abre planilha
    print("\n[2/5] Abrindo planilha...")
    ws = abrir_planilha()
    existentes = urls_existentes(ws)

    # 3. Filtra posts relevantes
    print("\n[3/5] Filtrando posts relevantes...")
    posts_filtrados = []
    for post in posts:
        url     = (post.get("url") or post.get("shortCode") or "").rstrip("/")
        caption = limpar_texto(post.get("caption") or post.get("text") or "")
        autor   = post.get("ownerUsername") or post.get("authorUsername") or ""

        if url in existentes:
            continue
        if not e_relevante_para_radar(caption, autor):
            continue

        posts_filtrados.append({
            "url":               url,
            "caption":           caption,
            "autor":             autor,
            "categoria":         categoria_perfil(autor),
            "data_post":         formatar_data(post.get("timestamp") or post.get("createdAt") or ""),
            "curtidas":          int(post.get("likesCount") or post.get("likes") or 0),
            "comentarios_count": int(post.get("commentsCount") or post.get("comments") or 0),
        })

    print(f"  {len(posts_filtrados)} posts relevantes e novos.")
    if not posts_filtrados:
        print("Nenhum post novo para processar. Encerrando.")
        return

    # 4. Coleta comentários
    print("\n[4/5] Coletando comentários...")
    urls_para_comentar = [p["url"] for p in posts_filtrados if p["url"].startswith("http")]
    mapa_comentarios = coletar_comentarios(urls_para_comentar)

    # 5. Analisa e grava
    print("\n[5/5] Analisando com Claude e gravando na planilha...")
    linhas = []
    novos  = 0
    erros  = 0

    for post in posts_filtrados:
        url       = post["url"]
        autor     = post["autor"]
        categoria = post["categoria"]
        comentarios_lista = mapa_comentarios.get(url, [])

        try:
            analise = analisar_post(post["caption"], comentarios_lista, autor, categoria)
        except Exception as e:
            print(f"  ✗ Erro ao analisar {url}: {e}")
            erros += 1
            continue

        comentaristas_unicos = ", ".join(sorted(set(
            c.split(":")[0].strip() for c in comentarios_lista if ":" in c
        ))[:10])

        linha = [
            url,
            post["data_post"],
            autor,
            categoria,
            post["curtidas"],
            post["comentarios_count"],
            analise.get("sentimento_post", ""),
            analise.get("sentimento_comentarios", ""),
            analise.get("comentarios_negativos_pct", ""),
            analise.get("comentarios_positivos_pct", ""),
            len(comentarios_lista),
            comentaristas_unicos,
            analise.get("comentarios_positivos_texto", ""),
            analise.get("comentarios_negativos_texto", ""),
            analise.get("comentarios_destaque", ""),
            analise.get("tema", ""),
            analise.get("tema_sensivel", ""),
            analise.get("urgencia", ""),
            analise.get("risco_crise", ""),
            analise.get("tendencia", ""),
            analise.get("engajamento", ""),
            analise.get("resumo", ""),
            analise.get("atribuicao", ""),
            analise.get("sugestao_acao", ""),
        ]
        linhas.append(linha)
        existentes.add(url)
        novos += 1

        print(
            f"  ✓ [{categoria}] {autor} | {analise.get('tema')} | "
            f"{analise.get('urgencia')} | {len(comentarios_lista)} comentários"
        )

    if linhas:
        ws.append_rows(linhas, value_input_option="USER_ENTERED")

    print(f"\n{'='*60}")
    print(f"Concluído: {novos} novos | {erros} erros")
    print(f"{'='*60}")


if __name__ == "__main__":
    processar()
