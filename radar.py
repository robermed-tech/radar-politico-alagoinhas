import os
import re
import json
import requests
import gspread
import anthropic
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from tenacity import retry, stop_after_attempt, wait_exponential

load_dotenv()

APIFY_API_TOKEN = os.environ["APIFY_API_TOKEN"]
APIFY_DATASET_ID = os.environ["APIFY_DATASET_ID"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
GOOGLE_SHEET_ID = os.environ["GOOGLE_SHEET_ID"]
GOOGLE_SHEET_NAME = os.environ.get("GOOGLE_SHEET_NAME", "Radar")
GOOGLE_SHEET_PERFIS = "Perfis"

# Workers paralelos para chamadas ao Claude (limitado pela quota da API)
MAX_WORKERS = 8

# ── PERFIS MONITORADOS ────────────────────────────────────────────────────────
# Fonte única de verdade: run_pipeline.py gera directUrls a partir deste dict.
# Para adicionar um novo perfil: adicione aqui APENAS.
PROFILES_META = {
    # Portais de notícias locais
    "alagoinhas24h":         {"categoria": "Portal de noticias", "influencia": "alta"},
    "alagonews":             {"categoria": "Portal de noticias", "influencia": "alta"},
    "portalalagoinhasnews":  {"categoria": "Portal de noticias", "influencia": "media"},
    "seligaalagoinhas":      {"categoria": "Portal de noticias", "influencia": "media"},
    "jornalalagoinhas":      {"categoria": "Portal de noticias", "influencia": "media"},
    "suacidade":             {"categoria": "Portal de noticias", "influencia": "media"},
    "aloalagoinhas":         {"categoria": "Portal de noticias", "influencia": "media"},
    "noticiasalagoinhas_":   {"categoria": "Portal de noticias", "influencia": "media"},
    "regiao_pauta":          {"categoria": "Portal de noticias", "influencia": "media"},
    "alvoradaruadocatu":     {"categoria": "Portal de noticias", "influencia": "baixa"},
    # Políticos
    "oficialjoaquimneto":    {"categoria": "Politico",           "influencia": "alta"},
    "soulucianoalmeida":     {"categoria": "Politico",           "influencia": "alta"},
    "paulocezar_oficial":    {"categoria": "Politico",           "influencia": "media"},
    "jaldicenunes":          {"categoria": "Politico",           "influencia": "media"},
    "gleysersoares":         {"categoria": "Comunicador",        "influencia": "alta"},
    "eulumamenezes":         {"categoria": "Influencer",         "influencia": "media"},
    # Institucionais
    "prefeituraalagoinhas":  {"categoria": "Prefeitura",         "influencia": "alta"},
    "gustavoascarmo":        {"categoria": "Prefeito",           "influencia": "alta"},
}

ALLOWED_PROFILES = set(PROFILES_META.keys())

SHEET_HEADERS = [
    "url", "data_post", "autor",
    "sentimento_post", "sentimento_comentarios",
    "tema", "urgencia", "resumo", "atribuicao",
    "curtidas", "comentarios_count",
    # colunas do framework v1.0 (adicionadas ao final para retrocompatibilidade)
    "categoria_tematica", "intensidade", "localizacao",
]

PERFIS_HEADERS = [
    "perfil", "categoria", "influencia", "total_posts", "positivos",
    "negativos", "neutros", "pct_positivo", "pct_negativo",
    "temperatura", "resumo_geral", "data_atualizacao",
]

# ── PROMPT DE ANÁLISE DE POST (Framework v1.0 — 4 dimensões) ─────────────────
ANALYSIS_PROMPT = """Voce e um analista senior de midias sociais da Prefeitura de Alagoinhas/BA,
apoiando a gestao estrategica do Prefeito Gustavo Carmo com base no Framework de Analise v1.0.

ANALISE APENAS posts com relacao DIRETA com:
- A Prefeitura de Alagoinhas, seus servicos e obras municipais
- O Prefeito Gustavo Carmo e sua gestao
- Secretarias e orgaos municipais de Alagoinhas
- Problemas urbanos de Alagoinhas sob responsabilidade do municipio
- Opiniao publica sobre a administracao municipal

NAO analise posts sobre:
- Outros municipios ou estados sem relacao direta a Alagoinhas
- Acidentes ou crimes sem vinculo com gestao publica municipal
- Politica estadual/federal sem impacto direto na gestao local
- Entretenimento, esporte ou conteudo sem relacao com a gestao
- Fraudes, golpes ou noticias gerais sem impacto municipal

=== POST ===
Perfil: @{username} ({categoria}, influencia: {influencia})
Caption: {caption}

=== COMENTARIOS ({comments_count} disponiveis) ===
{comments_block}

=== INSTRUCOES ===
Se o post NAO tiver relacao com a gestao municipal de Alagoinhas, retorne SOMENTE:
{{"relevante": false}}

Se o post FOR relevante, preencha com precisao os campos abaixo seguindo as 4 dimensoes do framework:

DIMENSAO 1 — TOPICO E SENTIMENTO:
1. sentimento_post: sentimento do TEXTO DO POST (caption) — positivo | negativo | neutro
2. sentimento_comentarios: sentimento GERAL dos comentarios — positivo | negativo | neutro | misto
   - "misto" quando ha tanto comentarios positivos quanto negativos relevantes
   - Se nao houver comentarios, use "neutro"
3. categoria_tematica: categoria tematica do framework (use EXATAMENTE uma das 14 opcoes):
   saude | educacao | infraestrutura_urbana | limpeza_urbana | seguranca_publica |
   transporte_publico | saneamento_agua | assistencia_social | tributos_servicos |
   cultura_esporte_lazer | servidores_municipais | imagem_gestao | meio_ambiente | zona_rural
4. tema: subtema especifico do post em ate 6 palavras (ex: "buracos na Rua X", "falta medico posto Y")

DIMENSAO 2 — ATRIBUICAO DE RESPONSABILIDADE:
5. atribuicao: a quem a POPULACAO esta atribuindo o assunto — use EXATAMENTE uma das opcoes:
   prefeito_pessoal | prefeitura_instituicao | secretaria_saude | secretaria_educacao |
   secretaria_obras | secretaria_outra | vereadores | governo_estadual | governo_federal |
   gestao_anterior | propria_populacao | empresas_concessionarias | indefinido
   - prefeito_pessoal: mencao direta ao nome "Gustavo", "prefeito", marcacao do perfil pessoal
   - prefeitura_instituicao: "a prefeitura", "a gestao", "a administracao" (impessoal)
   - secretaria_X: mencao a secretaria especifica ou seu titular

DIMENSAO 3 — INTENSIDADE E URGENCIA:
6. intensidade: intensidade emocional dos comentarios — leve | moderada | alta
   - alta: xingamentos, ameacas, exclamacoes multiplas, caps lock, marcacao de autoridades
   - moderada: criticas diretas mas sem agressividade, insatisfacao clara
   - leve: mencao casual, solicitacao cordial, elogio, informativo
7. urgencia: prioridade de atencao da prefeitura — alta | media | baixa
   - alta: situacao de risco, crise em formacao, repercussao ampla, requer resposta em 24h

DIMENSAO 4 — TERRITORIO E IMPACTO:
8. localizacao: bairro, distrito, rua ou area de Alagoinhas mencionada — ou "nao_identificado"
9. resumo: 2-3 frases sobre: (1) o que o post/comentarios revelam, (2) impacto para a gestao, (3) acao recomendada

Retorne SOMENTE o JSON (sem texto adicional):
{{
  "relevante": true,
  "sentimento_post": "positivo|negativo|neutro",
  "sentimento_comentarios": "positivo|negativo|neutro|misto",
  "categoria_tematica": "<uma das 14 categorias>",
  "tema": "<subtema especifico>",
  "atribuicao": "<uma das 13 opcoes>",
  "intensidade": "leve|moderada|alta",
  "urgencia": "alta|media|baixa",
  "localizacao": "<bairro_ou_nao_identificado>",
  "resumo": "<resumo com 2-3 frases>"
}}"""

# ── PROMPT DE RESUMO DE PERFIL ────────────────────────────────────────────────
PROFILE_SUMMARY_PROMPT = """Voce e um analista senior de midias sociais da Prefeitura de Alagoinhas/BA.

Analise os posts do perfil @{perfil} ({categoria}, influencia: {influencia}) e escreva um resumo analitico em 3-4 frases cobrindo:
1. Posicionamento geral deste perfil em relacao a gestao do Prefeito Gustavo Carmo
2. Principais temas e categorias abordados (use as categorias do framework: saude, educacao, infraestrutura, etc.)
3. Nivel de criticidade ou apoio — e se ha sinais de pauta emergente ou organizada
4. Recomendacao de atencao: se a prefeitura deve monitorar de perto, responder ativamente, ou apenas acompanhar

Posts analisados:
{posts_resumo}

Estatisticas do periodo:
- Total de posts relevantes: {total}
- Positivos: {positivos} ({pct_pos}%) | Negativos: {negativos} ({pct_neg}%) | Neutros: {neutros}
- Temperatura geral: {temperatura}
- Temas mais frequentes: {temas_freq}

Escreva apenas o resumo analitico. Tom tecnico e objetivo. Sem titulos, sem marcadores."""


# ── VALIDAÇÃO DE SAÍDA DO CLAUDE ──────────────────────────────────────────────
# Garante que valores fora do schema não entrem na planilha.

VALID_CATEGORIAS = {
    "saude", "educacao", "infraestrutura_urbana", "limpeza_urbana",
    "seguranca_publica", "transporte_publico", "saneamento_agua",
    "assistencia_social", "tributos_servicos", "cultura_esporte_lazer",
    "servidores_municipais", "imagem_gestao", "meio_ambiente", "zona_rural",
}
VALID_ATRIBUICOES = {
    "prefeito_pessoal", "prefeitura_instituicao", "secretaria_saude",
    "secretaria_educacao", "secretaria_obras", "secretaria_outra",
    "vereadores", "governo_estadual", "governo_federal",
    "gestao_anterior", "propria_populacao", "empresas_concessionarias", "indefinido",
}
VALID_URGENCIAS    = {"alta", "media", "baixa"}
VALID_INTENSIDADES = {"leve", "moderada", "alta"}
VALID_SENTIMENTOS  = {"positivo", "negativo", "neutro", "misto"}


def validate_analysis(analysis):
    """Normaliza e valida os campos do JSON retornado pelo Claude.
    Valores fora do enum recebem o default mais conservador.
    """
    if not analysis.get("relevante", True):
        return analysis

    def _norm(val, valid_set, default):
        v = str(val or "").strip().lower()
        return v if v in valid_set else default

    analysis["categoria_tematica"] = _norm(
        analysis.get("categoria_tematica"), VALID_CATEGORIAS, "imagem_gestao"
    )
    analysis["atribuicao"] = _norm(
        analysis.get("atribuicao"), VALID_ATRIBUICOES, "indefinido"
    )
    analysis["urgencia"] = _norm(
        analysis.get("urgencia"), VALID_URGENCIAS, "baixa"
    )
    analysis["intensidade"] = _norm(
        analysis.get("intensidade"), VALID_INTENSIDADES, "leve"
    )
    analysis["sentimento_post"] = _norm(
        analysis.get("sentimento_post"), {"positivo", "negativo", "neutro"}, "neutro"
    )
    analysis["sentimento_comentarios"] = _norm(
        analysis.get("sentimento_comentarios"), VALID_SENTIMENTOS, "neutro"
    )
    return analysis


# ── UTILITÁRIOS ───────────────────────────────────────────────────────────────

def clean_text(text):
    if not text:
        return ""
    text = str(text).replace("\n", " ").replace("\r", " ")
    text = text.replace('"', "'")
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def format_date(timestamp):
    if not timestamp:
        return ""
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return timestamp[:16] if len(timestamp) >= 16 else timestamp


def extract_username_from_url(url):
    """Tenta extrair o username do Instagram a partir da URL do post."""
    m = re.search(r'instagram\.com/([^/]+)/p/', url or '')
    if m:
        candidate = m.group(1)
        if candidate != 'p' and len(candidate) > 1:
            return candidate.lower()
    return ""


def extract_comments(item):
    """
    Extrai TODOS os textos de comentários disponíveis no item Apify.
    Prioriza latestComments (lista completa), com fallback para firstComment.
    Retorna uma lista de strings (máx. 15 comentários).
    """
    texts = []

    # 1) latestComments é a fonte primária — contém objetos {id, text, ownerUsername, ...}
    latest = item.get("latestComments") or []
    for c in latest:
        if isinstance(c, dict):
            t = clean_text(c.get("text", ""))
        else:
            t = clean_text(str(c))
        if t and t not in texts:
            texts.append(t)

    # 2) firstComment como fallback se latestComments veio vazio
    if not texts:
        fc = clean_text(item.get("firstComment") or item.get("topComment") or "")
        if fc:
            texts.append(fc)

    # Limita a 15 comentários para não explodir o context
    return texts[:15]


def build_comments_block(comments):
    """Formata os comentários para inserção no prompt."""
    if not comments:
        return "(nenhum comentario disponivel)"
    lines = []
    for i, t in enumerate(comments, 1):
        # Trunca cada comentário em 250 chars para manter o prompt compacto
        truncated = t[:250] + "…" if len(t) > 250 else t
        lines.append(f"{i}. {truncated}")
    return "\n".join(lines)


# ── CHAMADA AO CLAUDE COM RETRY ───────────────────────────────────────────────

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True,
)
def _call_haiku(client, messages, max_tokens):
    """Chama o Claude Haiku com retry automático para erros transitórios de rede/rate-limit."""
    return client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        messages=messages,
    )


# ── ANÁLISE COM CLAUDE ─────────────────────────────────────────────────────────

def analyse_post(client, item):
    """
    Analisa um post usando o modelo Claude Haiku.
    Passa caption + TODOS os comentários disponíveis para análise precisa.
    """
    username = (item.get("ownerUsername") or "").lower().strip()
    categoria = PROFILES_META.get(username, {}).get("categoria", "desconhecido")
    caption = clean_text(item.get("caption") or item.get("text") or "")
    comments = extract_comments(item)
    comments_block = build_comments_block(comments)
    influencia = PROFILES_META.get(username, {}).get("influencia", "desconhecida")

    prompt = ANALYSIS_PROMPT.format(
        username=username,
        categoria=categoria,
        influencia=influencia,
        caption=caption or "(sem caption)",
        comments_count=len(comments),
        comments_block=comments_block,
    )

    message = _call_haiku(client, [{"role": "user", "content": prompt}], 900)
    raw = message.content[0].text.strip()

    # Extrai JSON mesmo que o modelo adicione texto extra
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError(f"JSON nao encontrado na resposta: {raw[:200]}")
    return json.loads(match.group(0))


def calc_temperatura(negativos, total):
    pct = negativos / total if total > 0 else 0
    if pct >= 0.6:
        return "critica"
    elif pct >= 0.4:
        return "alta"
    elif pct >= 0.2:
        return "moderada"
    else:
        return "baixa"


def analyse_profile(client, perfil, meta, posts_data):
    if not posts_data:
        return "Nenhum post relevante encontrado no periodo."

    categoria = meta.get("categoria", "desconhecido")
    influencia = meta.get("influencia", "desconhecida")
    positivos = sum(1 for p in posts_data if p["sentimento"] == "positivo")
    negativos = sum(1 for p in posts_data if p["sentimento"] == "negativo")
    neutros = sum(1 for p in posts_data if p["sentimento"] == "neutro")
    total = len(posts_data)
    temperatura = calc_temperatura(negativos, total)
    pct_pos = round(positivos / total * 100) if total > 0 else 0
    pct_neg = round(negativos / total * 100) if total > 0 else 0

    # Frequência de categorias temáticas
    cat_counts = {}
    for p in posts_data:
        cat = p.get("categoria_tematica", "")
        if cat:
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
    temas_freq = ", ".join(
        f"{cat} ({n})"
        for cat, n in sorted(cat_counts.items(), key=lambda x: -x[1])[:4]
    ) or "nao disponivel"

    posts_resumo = "\n".join([
        f"- [{p['sentimento'].upper()}][{p.get('categoria_tematica','?')}] {p['tema']}: {p['resumo'][:150]}"
        for p in posts_data[:15]
    ])

    prompt = PROFILE_SUMMARY_PROMPT.format(
        perfil=perfil,
        categoria=categoria,
        influencia=influencia,
        posts_resumo=posts_resumo,
        total=total,
        positivos=positivos,
        pct_pos=pct_pos,
        negativos=negativos,
        pct_neg=pct_neg,
        neutros=neutros,
        temperatura=temperatura,
        temas_freq=temas_freq,
    )

    message = _call_haiku(client, [{"role": "user", "content": prompt}], 450)
    return message.content[0].text.strip()


# ── GOOGLE SHEETS ─────────────────────────────────────────────────────────────

def open_spreadsheet():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(GOOGLE_SERVICE_ACCOUNT_FILE, scopes=scopes)
    gc = gspread.authorize(creds)
    return gc.open_by_key(GOOGLE_SHEET_ID)


def get_or_create_ws(spreadsheet, name, headers):
    try:
        ws = spreadsheet.worksheet(name)
        first_row = ws.row_values(1)
        if not first_row:
            ws.insert_row(headers, index=1)
        elif first_row == headers:
            pass  # Schema correto, nada a fazer
        else:
            existing = set(first_row)
            new_cols = [h for h in headers if h not in existing]
            if new_cols:
                next_col = len(first_row) + 1
                for col_name in new_cols:
                    ws.update_cell(1, next_col, col_name)
                    next_col += 1
                print(f"  Schema migrado: colunas adicionadas: {new_cols}")
            elif set(headers) == set(first_row):
                pass
            else:
                print(f"  Schema incompativel — recriando planilha '{name}'")
                ws.clear()
                ws.insert_row(headers, index=1)
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=name, rows=1000, cols=len(headers))
        ws.insert_row(headers, index=1)
    return ws


def get_existing_urls(ws):
    url_col = ws.col_values(1)
    return set(url_col[1:])


def append_post(ws, url, analysis, item):
    comments_count = item.get("commentsCount") or len(item.get("latestComments") or [])
    row = [
        url,
        format_date(item.get("timestamp", "")),
        item.get("ownerUsername", ""),
        analysis.get("sentimento_post", ""),
        analysis.get("sentimento_comentarios", ""),
        analysis.get("tema", ""),
        analysis.get("urgencia", ""),
        analysis.get("resumo", ""),
        analysis.get("atribuicao", ""),
        item.get("likesCount", 0),
        comments_count,
        # Framework v1.0 — novas dimensões (colunas 12-14)
        analysis.get("categoria_tematica", ""),
        analysis.get("intensidade", ""),
        analysis.get("localizacao", "nao_identificado"),
    ]
    ws.append_row(row, value_input_option="RAW")


def update_profile_row(ws_perfis, perfil, meta, posts_data, resumo_geral, all_values_cache):
    """
    Atualiza ou insere a linha do perfil na aba Perfis.
    Recebe e retorna o cache de all_values para evitar múltiplas leituras da planilha.
    """
    total = len(posts_data)
    positivos = sum(1 for p in posts_data if p["sentimento"] == "positivo")
    negativos = sum(1 for p in posts_data if p["sentimento"] == "negativo")
    neutros = sum(1 for p in posts_data if p["sentimento"] == "neutro")
    pct_pos = round(positivos / total * 100) if total > 0 else 0
    pct_neg = round(negativos / total * 100) if total > 0 else 0
    temperatura = calc_temperatura(negativos, total)
    now = datetime.now().strftime("%d/%m/%Y %H:%M")

    row = [
        perfil, meta["categoria"], meta["influencia"],
        total, positivos, negativos, neutros,
        pct_pos, pct_neg, temperatura,
        resumo_geral, now,
    ]

    for i, r in enumerate(all_values_cache[1:], start=2):
        if r and r[0] == perfil:
            ws_perfis.update(range_name=f"A{i}:L{i}", values=[row])
            all_values_cache[i - 1] = row  # mantém cache consistente
            return all_values_cache

    ws_perfis.append_row(row, value_input_option="RAW")
    all_values_cache.append(row)
    return all_values_cache


# ── WORKERS PARA EXECUÇÃO PARALELA ────────────────────────────────────────────

def _analyse_item(args):
    """Worker para ThreadPoolExecutor: analisa um post e retorna resultado."""
    client, item = args
    url = item.get("url") or item.get("postUrl") or item.get("link") or ""
    analysis = analyse_post(client, item)
    return item, url, validate_analysis(analysis)


def _analyse_profile_worker(args):
    """Worker para ThreadPoolExecutor: gera resumo analítico de um perfil."""
    client, perfil, meta, posts_data = args
    resumo = analyse_profile(client, perfil, meta, posts_data)
    return perfil, meta, posts_data, resumo


# ── COLETA DO DATASET APIFY ───────────────────────────────────────────────────

def fetch_apify_items():
    url = (
        f"https://api.apify.com/v2/datasets/{APIFY_DATASET_ID}"
        "/items?format=json&clean=true"
    )
    # Bearer header é mais seguro que token em query param (não aparece em logs de acesso)
    headers = {"Authorization": f"Bearer {APIFY_API_TOKEN}"}
    response = requests.get(url, headers=headers, timeout=60)
    response.raise_for_status()
    return response.json()


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main(force_reanalyze=False, dry_run=False):
    if dry_run:
        print("*** MODO DRY-RUN: nenhum dado sera gravado ***")

    print("Conectando ao Google Sheets...")
    spreadsheet = open_spreadsheet()
    ws_radar = get_or_create_ws(spreadsheet, GOOGLE_SHEET_NAME, SHEET_HEADERS)
    ws_perfis = get_or_create_ws(spreadsheet, GOOGLE_SHEET_PERFIS, PERFIS_HEADERS)

    existing_urls = get_existing_urls(ws_radar)
    if force_reanalyze:
        print(f"Modo --reanalizar: ignorando {len(existing_urls)} URLs existentes. Re-analisa TUDO.")
        existing_urls = set()
        if not dry_run:
            print("Limpando aba Radar para re-analise completa...")
            ws_radar.clear()
            ws_radar.insert_row(SHEET_HEADERS, index=1)
    else:
        print(f"{len(existing_urls)} posts ja registrados na planilha.")

    print("Buscando itens do Apify...")
    items = fetch_apify_items()
    print(f"{len(items)} itens encontrados no dataset.")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    counters = {
        "novos": 0, "duplicatas": 0, "perfil_ignorado": 0,
        "irrelevantes": 0, "erros": 0, "sem_username": 0,
    }
    profile_posts = {p: [] for p in ALLOWED_PROFILES}
    unknown_profiles = {}

    # ── FASE 1: Filtrar itens válidos (rápido, sem API) ──────────────────────
    to_analyse = []
    for item in items:
        url = item.get("url") or item.get("postUrl") or item.get("link") or ""
        if not url:
            continue

        username = (item.get("ownerUsername") or "").lower().strip()
        if not username:
            username = extract_username_from_url(url)
        if not username:
            counters["sem_username"] += 1
            print(f"  SEM_USERNAME: {url[:80]}")
            continue

        if url in existing_urls:
            counters["duplicatas"] += 1
            continue

        if username not in ALLOWED_PROFILES:
            counters["perfil_ignorado"] += 1
            unknown_profiles[username] = unknown_profiles.get(username, 0) + 1
            continue

        to_analyse.append(item)

    print(f"{len(to_analyse)} posts novos para analisar (workers={MAX_WORKERS})...")

    # ── FASE 2: Análise paralela com Claude ──────────────────────────────────
    # gspread não é thread-safe, então só chamamos o Claude em paralelo aqui;
    # a escrita na planilha acontece sequencialmente na Fase 3.
    analysed = []  # lista de (item, url, analysis)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(_analyse_item, (client, item)): item
            for item in to_analyse
        }
        for future in as_completed(future_map):
            item = future_map[future]
            username = (item.get("ownerUsername") or "").lower().strip()
            n_comments = len(item.get("latestComments") or [])
            try:
                result_item, url, analysis = future.result()
                analysed.append((result_item, url, analysis))
                print(
                    f"  OK @{username} | cat={analysis.get('categoria_tematica')} "
                    f"| sent={analysis.get('sentimento_post')} "
                    f"| urg={analysis.get('urgencia')} "
                    f"[{n_comments} comentarios]"
                )
            except Exception as exc:
                url = item.get("url") or item.get("postUrl") or "?"
                print(f"  ERRO @{username} {url[-40:]}: {exc}")
                counters["erros"] += 1

    # ── FASE 3: Gravar resultados sequencialmente (gspread não é thread-safe) ─
    for item, url, analysis in analysed:
        if not analysis.get("relevante", True):
            print(f"  Ignorado — sem relacao com a gestao de Alagoinhas.")
            counters["irrelevantes"] += 1
            continue

        if not dry_run:
            append_post(ws_radar, url, analysis, item)
        existing_urls.add(url)
        counters["novos"] += 1

        username = (item.get("ownerUsername") or "").lower().strip()
        if not username:
            username = extract_username_from_url(url)

        if username in profile_posts:
            profile_posts[username].append({
                "sentimento": analysis.get("sentimento_post", "neutro"),
                "tema": analysis.get("tema", ""),
                "resumo": analysis.get("resumo", ""),
                "urgencia": analysis.get("urgencia", "baixa"),
                "categoria_tematica": analysis.get("categoria_tematica", ""),
                "intensidade": analysis.get("intensidade", ""),
                "atribuicao": analysis.get("atribuicao", ""),
                "localizacao": analysis.get("localizacao", ""),
            })

    # ── RESUMO ────────────────────────────────────────────────────────────────
    print(
        f"\nConcluido: {counters['novos']} novos | "
        f"{counters['duplicatas']} duplicatas | "
        f"{counters['perfil_ignorado']} perfis nao autorizados | "
        f"{counters['irrelevantes']} irrelevantes | "
        f"{counters['erros']} erros | "
        f"{counters['sem_username']} sem username"
    )
    if unknown_profiles:
        print(f"\nPerfis encontrados mas NAO em ALLOWED_PROFILES (considere adicionar):")
        for p, n in sorted(unknown_profiles.items(), key=lambda x: -x[1]):
            print(f"  @{p}: {n} posts")

    # ── ANÁLISE POR PERFIL (paralela + escrita sequencial) ───────────────────
    profiles_with_posts = {k: v for k, v in profile_posts.items() if v}
    if not profiles_with_posts:
        print("\nNenhum post novo para analise por perfil.")
        return

    print(f"\nGerando resumo por perfil ({len(profiles_with_posts)} perfis, workers={MAX_WORKERS})...")

    # Lê a planilha de perfis UMA vez e reutiliza como cache em todas as atualizações
    all_perfis_cache = ws_perfis.get_all_values()

    # Análise de perfis em paralelo (cada chamada é independente)
    profile_results = []
    profile_args = [
        (client, perfil, PROFILES_META[perfil], posts_data)
        for perfil, posts_data in profiles_with_posts.items()
    ]
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(profile_args))) as executor:
        future_map = {
            executor.submit(_analyse_profile_worker, args): args[1]
            for args in profile_args
        }
        for future in as_completed(future_map):
            perfil = future_map[future]
            try:
                perfil_r, meta, posts_data, resumo = future.result()
                profile_results.append((perfil_r, meta, posts_data, resumo))
                print(f"  @{perfil_r} resumo gerado.")
            except Exception as e:
                print(f"  ERRO @{perfil}: {e}")

    # Escrita sequencial usando cache (evita get_all_values() por perfil)
    for perfil, meta, posts_data, resumo in profile_results:
        if not dry_run:
            all_perfis_cache = update_profile_row(
                ws_perfis, perfil, meta, posts_data, resumo, all_perfis_cache
            )
        print(f"  @{perfil} atualizado.")

    print("Analise por perfil concluida!")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Radar Politico — pipeline de coleta e analise")
    parser.add_argument(
        "--reanalizar",
        action="store_true",
        help="Re-analisa TODOS os posts (ignora duplicatas). Use para corrigir dados incorretos.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Apenas mostra o que seria analisado, sem gravar na planilha.",
    )
    args = parser.parse_args()
    main(force_reanalyze=args.reanalizar, dry_run=args.dry_run)
