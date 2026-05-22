import os
import re
import json
import sys
import requests
import gspread
import anthropic
from datetime import datetime
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

# ── Credenciais ──────────────────────────────────────────────────────────────
APIFY_API_TOKEN            = os.environ["APIFY_API_TOKEN"]
APIFY_ACTOR_ID             = os.environ.get("APIFY_ACTOR_ID", "")          # ex: apify/instagram-scraper
ANTHROPIC_API_KEY          = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
GOOGLE_SHEET_ID            = os.environ["GOOGLE_SHEET_ID"]
GOOGLE_SHEET_NAME          = os.environ.get("GOOGLE_SHEET_NAME", "Radar")

# ── Colunas da planilha ──────────────────────────────────────────────────────
SHEET_HEADERS = [
    "url", "data_post", "autor",
    "sentimento_post", "sentimento_comentarios",
    "tema", "urgencia", "resumo", "atribuicao"
]

# ── Filtro de relevância ─────────────────────────────────────────────────────
KEYWORDS = [
    "prefeitura", "gustavo", "prefeito", "alagoinhas",
    "municipio", "município", "secom", "secretar"
]

# ── Prompt de análise ────────────────────────────────────────────────────────
ANALYSIS_PROMPT = """\
Você é um analista político da Prefeitura de Alagoinhas/BA.
Analise o post abaixo e retorne SOMENTE um JSON válido, sem texto extra, sem markdown.

Post:
{texto}

Comentários:
{comentarios}

Retorne exatamente este JSON:
{{
  "sentimento_post": "Positivo" | "Negativo" | "Neutro",
  "sentimento_comentarios": "Positivo" | "Negativo" | "Neutro" | "Sem comentários",
  "tema": "Saúde" | "Obras" | "Educação" | "Segurança" | "Política" | "Social" | "Outro",
  "urgencia": "Alta" | "Média" | "Baixa",
  "resumo": "<resumo em até 10 palavras>",
  "atribuicao": "<a quem o post se refere, ex: Prefeitura, Gustavo Carmo, Oposição>"
}}"""


# ── Utilitários ──────────────────────────────────────────────────────────────

def limpar_texto(texto: str) -> str:
    """Remove emojis, URLs e quebras de linha excessivas."""
    if not texto:
        return "sem texto"
    texto = re.sub(r"http\S+", "", texto)
    texto = re.sub(r"[^\w\s\.,!?;:\-áéíóúàâêôãõüçÁÉÍÓÚÀÂÊÔÃÕÜÇ]", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto or "sem texto"


def tem_keyword(texto: str) -> bool:
    t = texto.lower()
    return any(k in t for k in KEYWORDS)


def formatar_data(ts: str) -> str:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return ts or ""


# ── Apify ────────────────────────────────────────────────────────────────────

def obter_ultimo_dataset_id() -> str:
    """
    Busca automaticamente o Dataset ID do último run bem-sucedido do ator.
    Elimina a necessidade de atualizar o .env manualmente após cada run.
    """
    if not APIFY_ACTOR_ID:
        raise ValueError(
            "APIFY_ACTOR_ID não definido no .env. "
            "Adicione a linha: APIFY_ACTOR_ID=apify/instagram-scraper"
        )

    url = (
       f"https://api.apify.com/v2/actor-runs"
    f"?token={APIFY_API_TOKEN}&status=SUCCEEDED&limit=1"
    f"&actorId={APIFY_ACTOR_ID}"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    runs = resp.json().get("data", {}).get("items", [])

    if not runs:
        raise RuntimeError("Nenhum run SUCCEEDED encontrado para o ator informado.")

    dataset_id = runs[0].get("defaultDatasetId", "")
    if not dataset_id:
        raise RuntimeError("Dataset ID não encontrado no último run.")

    print(f"Dataset ID encontrado automaticamente: {dataset_id}")
    return dataset_id


def buscar_posts(dataset_id: str) -> list[dict]:
    url = (
        f"https://api.apify.com/v2/datasets/{dataset_id}/items"
        f"?token={APIFY_API_TOKEN}&format=json&clean=true"
    )
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


# ── Google Sheets ────────────────────────────────────────────────────────────

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
    # Garante cabeçalho
    if not ws.row_values(1):
        ws.append_row(SHEET_HEADERS)
    return ws


def urls_existentes(ws) -> set[str]:
    col_url = 1  # coluna A
    valores = ws.col_values(col_url)
    return set(valores[1:])  # ignora cabeçalho


# ── Claude API ───────────────────────────────────────────────────────────────

def analisar_post(texto: str, comentarios: str) -> dict:
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = ANALYSIS_PROMPT.format(texto=texto, comentarios=comentarios)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    # Remove possível markdown residual
    raw = re.sub(r"```(?:json)?|```", "", raw).strip()
    return json.loads(raw)


# ── Pipeline principal ───────────────────────────────────────────────────────

def processar(dataset_id: str | None = None):
    # 1. Dataset ID automático ou via argumento
    if not dataset_id:
        dataset_id = obter_ultimo_dataset_id()

    # 2. Busca posts do Apify
    print("Buscando posts do Apify...")
    posts = buscar_posts(dataset_id)
    print(f"  {len(posts)} posts recebidos.")

    if not posts:
        print("Nenhum post encontrado. Encerrando.")
        return

    # 3. Abre planilha e carrega URLs já gravadas
    print("Abrindo planilha...")
    ws = abrir_planilha()
    existentes = urls_existentes(ws)

    novos = 0
    ignorados = 0
    linhas = []

    for post in posts:
        url = post.get("url") or post.get("shortCode") or ""

        # Deduplicação
        if url in existentes:
            ignorados += 1
            continue

        caption     = limpar_texto(post.get("caption") or post.get("text") or "")
        comentario  = limpar_texto(post.get("firstComment") or "")
        autor       = post.get("ownerUsername") or post.get("authorUsername") or ""
        data_post   = formatar_data(post.get("timestamp") or post.get("createdAt") or "")

        # Filtro de relevância (opcional — comente as 2 linhas abaixo para processar tudo)
        if not tem_keyword(caption + " " + comentario + " " + autor):
            ignorados += 1
            continue

        # Análise com Claude
        try:
            analise = analisar_post(caption, comentario)
        except Exception as e:
            print(f"  Erro ao analisar {url}: {e}")
            ignorados += 1
            continue

        linha = [
            url,
            data_post,
            autor,
            analise.get("sentimento_post", ""),
            analise.get("sentimento_comentarios", ""),
            analise.get("tema", ""),
            analise.get("urgencia", ""),
            analise.get("resumo", ""),
            analise.get("atribuicao", ""),
        ]
        linhas.append(linha)
        existentes.add(url)
        novos += 1
        print(f"  ✓ {autor} — {analise.get('tema')} / {analise.get('urgencia')}")

    # Grava tudo de uma vez (mais eficiente que linha a linha)
    if linhas:
        ws.append_rows(linhas, value_input_option="USER_ENTERED")

    print(f"\nConcluído: {novos} novos | {ignorados} ignorados (duplicatas/sem keyword).")


# ── Entrada ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Aceita Dataset ID como argumento opcional (útil para webhook do Apify)
    # Uso: python radar.py [DATASET_ID]
    dataset_id = sys.argv[1] if len(sys.argv) > 1 else None
    processar(dataset_id)
