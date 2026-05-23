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

APIFY_API_TOKEN             = os.environ["APIFY_API_TOKEN"]
APIFY_POST_ACTOR_ID         = os.environ.get("APIFY_POST_ACTOR_ID", "apify/instagram-post-scraper")
APIFY_COMMENT_ACTOR_ID      = os.environ.get("APIFY_COMMENT_ACTOR_ID", "apify/instagram-comment-scraper")
ANTHROPIC_API_KEY           = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
GOOGLE_SHEET_ID             = os.environ["GOOGLE_SHEET_ID"]
GOOGLE_SHEET_NAME           = os.environ.get("GOOGLE_SHEET_NAME", "Radar")

PERFIS = [
    "seligaalagoinhas", "gustavoascarmo", "portalalagoinhasnews",
    "oficialjoaquimneto", "prefeituraalagoinhas", "soulucianoalmeida",
    "jornalalagoinhas", "suacidade", "paulocezar_oficial",
    "jaldicenunes", "eulumamenezes", "alagoinhas24h",
    "alagonews", "gleysersoares",
]

SHEET_HEADERS = [
    "url", "data_post", "autor",
    "sentimento_post", "sentimento_comentarios",
    "comentarios_negativos_pct", "comentarios_positivos_pct",
    "tema", "tema_sensivel", "urgencia",
    "risco_crise", "tendencia", "engajamento",
    "resumo", "atribuicao", "sugestao_acao"
]

KEYWORDS = [
    "prefeitura", "gustavo", "prefeito", "alagoinhas",
    "municipio", "município", "secom", "secretar"
]

ANALYSIS_PROMPT = """\
Você é um analista político sênior da Prefeitura de Alagoinhas/BA, especializado em monitoramento de redes sociais e gestão de crises de comunicação.

Analise o post e os comentários abaixo com profundidade estratégica e retorne SOMENTE um JSON válido, sem texto extra, sem markdown.

Post:
{texto}

Comentários:
{comentarios}

Retorne exatamente este JSON:
{{
  "sentimento_post": "Positivo" | "Negativo" | "Neutro",
  "sentimento_comentarios": "Positivo" | "Negativo" | "Neutro" | "Sem comentários",
  "comentarios_negativos_pct": "<percentual estimado de comentários negativos, ex: 35%>",
  "comentarios_positivos_pct": "<percentual estimado de comentários positivos, ex: 45%>",
  "tema": "Saúde" | "Obras" | "Educação" | "Segurança" | "Política" | "Social" | "Transporte" | "Meio Ambiente" | "Outro",
  "tema_sensivel": "Sim" | "Não",
  "urgencia": "Alta" | "Média" | "Baixa",
  "risco_crise": "Alto" | "Médio" | "Baixo",
  "tendencia": "Crescendo" | "Estável" | "Diminuindo",
  "engajamento": "Alto" | "Médio" | "Baixo",
  "resumo": "<resumo objetivo do post em até 15 palavras>",
  "atribuicao": "<a quem o post se refere, ex: Prefeitura, Gustavo Carmo, Oposição, Câmara Municipal>",
  "sugestao_acao": "Monitorar" | "Responder publicamente" | "Acionar assessoria" | "Conter crise" | "Ampliar positivo"
}}

Critérios importantes:
- "tema_sensivel": marque Sim quando o tema pode gerar repercussão negativa ampla
- "risco_crise": Alto quando há comentários negativos crescentes + tema sensível + urgência alta
- "tendencia": avalie se o tom dos comentários está piorando, estável ou melhorando
- "engajamento": Alto acima de 50 comentários/curtidas, Médio entre 10-50, Baixo abaixo de 10
- "sugestao_acao": baseie na combinação de sentimento + risco + tendência"""


def limpar_texto(texto):
    if not texto:
        return "sem texto"
    texto = re.sub(r"http\S+", "", texto)
    texto = re.sub(r"[^\w\s\.,!?;:\-áéíóúàâêôãõüçÁÉÍÓÚÀÂÊÔÃÕÜÇ]", " ", texto)
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
        ws = sh.add_worksheet(GOOGLE_SHEET_NAME, rows=1000, cols=20)
    if not ws.row_values(1):
        ws.append_row(SHEET_HEADERS)
    return ws


def urls_existentes(ws):
    valores = ws.col_values(1)
    return set(valores[1:])


def analisar_post(texto, comentarios):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = ANALYSIS_PROMPT.format(texto=texto, comentarios=comentarios)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r"```(?:json)?|```", "", raw).strip()
    return json.loads(raw)


def coletar_comentarios(urls_posts):
    if not urls_posts:
        return {}

    print(f"\nColetando comentários de {len(urls_posts)} posts...")

    input_data = {
        "directUrls": urls_posts,
        "resultsLimit": 50,
        "includeReplies": True,
    }

    try:
        dataset_id = disparar_actor(APIFY_COMMENT_ACTOR_ID, input_data, timeout=300)
        items = buscar_items(dataset_id)
    except Exception as e:
        print(f"  Aviso: falha ao coletar comentários — {e}")
        return {}

    mapa = {}
    for item in items:
        post_url = (item.get("postUrl") or item.get("url") or "").rstrip("/")
        texto = item.get("text") or item.get("comment") or ""
        if post_url and texto:
            mapa.setdefault(post_url, []).append(limpar_texto(texto))

    print(f"  {len(items)} comentários coletados em {len(mapa)} posts.")
    return mapa


def processar():
    print("=" * 60)
    print("RADAR POLÍTICO — Alagoinhas/BA")
    print("=" * 60)
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

    print("\n[2/5] Abrindo planilha...")
    ws = abrir_planilha()
    existentes = urls_existentes(ws)

    print("\n[3/5] Filtrando posts relevantes...")
    posts_filtrados = []
    for post in posts:
        url     = post.get("url") or post.get("shortCode") or ""
        caption = limpar_texto(post.get("caption") or post.get("text") or "")
        autor   = post.get("ownerUsername") or post.get("authorUsername") or ""

        if url in existentes:
            continue
        if not tem_keyword(caption + " " + autor):
            continue

        posts_filtrados.append({
            "url": url.rstrip("/"),
            "caption": caption,
            "autor": autor,
            "data_post": formatar_data(post.get("timestamp") or post.get("createdAt") or ""),
        })

    print(f"  {len(posts_filtrados)} posts relevantes e novos.")

    if not posts_filtrados:
        print("Nenhum post novo para processar. Encerrando.")
        return

    print("\n[4/5] Coletando comentários...")
    urls_para_comentar = [p["url"] for p in posts_filtrados if p["url"].startswith("http")]
    mapa_comentarios = coletar_comentarios(urls_para_comentar)

    print("\n[5/5] Analisando com Claude e gravando na planilha...")
    linhas = []
    novos = 0
    erros = 0

    for post in posts_filtrados:
        url = post["url"]

        comentarios_lista = mapa_comentarios.get(url, [])
        if comentarios_lista:
            comentarios_texto = "\n".join(f"- {c}" for c in comentarios_lista[:30])
        else:
            comentarios_texto = "Sem comentários coletados."

        try:
            analise = analisar_post(post["caption"], comentarios_texto)
        except Exception as e:
            print(f"  Erro ao analisar {url}: {e}")
            erros += 1
            continue

        linha = [
            url,
            post["data_post"],
            post["autor"],
            analise.get("sentimento_post", ""),
            analise.get("sentimento_comentarios", ""),
            analise.get("comentarios_negativos_pct", ""),
            analise.get("comentarios_positivos_pct", ""),
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
        n_coments = len(comentarios_lista)
        print(f"  ✓ {post['autor']} | {analise.get('tema')} | {analise.get('urgencia')} | {n_coments} comentários")

    if linhas:
        ws.append_rows(linhas, value_input_option="USER_ENTERED")

    print(f"\n{'='*60}")
    print(f"Concluído: {novos} novos | {erros} erros")
    print(f"{'='*60}")


if __name__ == "__main__":
    processar()
