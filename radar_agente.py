"""
RADAR POLÍTICO ALAGOINHAS — Agente Adaptativo v1.0
====================================================
Evolução do radar.py com:
  - Memória contextual (últimos 7 dias + padrões aprendidos)
  - Análise com Claude Sonnet (mais capaz que Haiku)
  - Detecção de padrões automática (perfis reincidentes, temas escalando)
  - Sistema de feedback do assessor (aba Feedback no Sheets)
  - Score de risco composto (histórico + engajamento + tendência)
  - Relatório de contexto político antes de cada análise
"""

import os
import re
import json
import sys
import time
import requests
import gspread
import anthropic
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

# ── Credenciais ───────────────────────────────────────────────────────────────
APIFY_API_TOKEN             = os.environ["APIFY_API_TOKEN"]
APIFY_POST_ACTOR_ID         = os.environ.get("APIFY_POST_ACTOR_ID", "apify/instagram-post-scraper")
APIFY_COMMENT_ACTOR_ID      = os.environ.get("APIFY_COMMENT_ACTOR_ID", "apify/instagram-comment-scraper")
ANTHROPIC_API_KEY           = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
GOOGLE_SHEET_ID             = os.environ["GOOGLE_SHEET_ID"]
GOOGLE_SHEET_NAME           = os.environ.get("GOOGLE_SHEET_NAME", "Radar")

# ── Abas de memória ───────────────────────────────────────────────────────────
SHEET_MEMORIA    = "Memoria_Contexto"
SHEET_FEEDBACK   = "Feedback"
SHEET_PADROES    = "Padroes"

# ── Perfis monitorados ────────────────────────────────────────────────────────
PERFIS_CATEGORIAS = {
    "gustavoascarmo":       "Prefeito",
    "prefeituraalagoinhas": "Prefeitura",
    "seligaalagoinhas":     "Governo",
    "portalalagoinhasnews": "Imprensa",
    "alagonews":            "Imprensa",
    "jornalalagoinhas":     "Imprensa",
    "alagoinhas24h":        "Imprensa",
    "suacidade":            "Imprensa",
    "oficialjoaquimneto":   "Oposição",
    "soulucianoalmeida":    "Oposição",
    "paulocezar_oficial":   "Oposição",
    "jaldicenunes":         "Oposição",
    "eulumamenezes":        "Oposição",
    "gleysersoares":        "Oposição",
}
PERFIS       = list(PERFIS_CATEGORIAS.keys())
PERFIS_GESTAO = {"gustavoascarmo", "prefeituraalagoinhas"}

# ── Cabeçalhos ────────────────────────────────────────────────────────────────
SHEET_HEADERS = [
    "url", "data_post", "autor", "categoria_perfil",
    "curtidas", "comentarios_count",
    "sentimento_post", "sentimento_comentarios",
    "comentarios_negativos_pct", "comentarios_positivos_pct",
    "total_comentarios", "comentaristas",
    "comentarios_positivos_texto", "comentarios_negativos_texto", "comentarios_destaque",
    "tema", "tema_sensivel", "urgencia",
    "risco_crise", "score_risco", "tendencia", "engajamento",
    "resumo", "atribuicao", "sugestao_acao",
    "contexto_usado", "aprendizado_aplicado"
]

FEEDBACK_HEADERS = [
    "url", "data_analise", "autor", "tema", "urgencia", "sugestao_acao",
    "feedback", "data_feedback", "observacao"
]

MEMORIA_HEADERS = [
    "data_registro", "tipo", "perfil", "tema",
    "descricao", "frequencia", "ultima_ocorrencia", "relevancia"
]

PADROES_HEADERS = [
    "data_registro", "perfil", "tema", "dia_semana",
    "hora_media", "engajamento_medio", "sentimento_predominante",
    "frequencia_semanal", "observacao"
]

# ── Keywords ──────────────────────────────────────────────────────────────────
KEYWORDS_ANCORA   = ["alagoinhas", "gustavo"]
KEYWORDS_GESTAO   = [
    "prefeitura", "prefeito", "gustavo", "secom", "secretar",
    "municipio", "município", "gestao", "gestão", "administracao",
    "administração", "câmara", "camara", "vereador", "decreto",
    "licitacao", "licitação", "obra municipal", "servidor"
]
KEYWORDS_CONTEXTO = [
    "investimento", "investimentos", "obra", "obras", "infraestrutura",
    "saúde", "saude", "educação", "educacao", "segurança", "seguranca",
    "transporte", "saneamento", "habitação", "habitacao", "emprego",
    "desenvolvimento", "recurso", "recursos", "verba", "verbas",
    "governo", "estado", "federal", "convenio", "convênio",
    "inauguração", "inauguracao", "entrega", "licitação", "licitacao",
    "hospital", "escola", "creche", "posto de saúde", "ubs",
    "pavimentação", "pavimentacao", "asfalto", "drenagem", "esgoto",
    "iluminação", "iluminacao", "praça", "praca", "parque",
]
KEYWORDS_CRISE = [
    "corrupto", "corrupção", "roubo", "desvio", "escândalo",
    "incompetente", "vergonha", "impeachment", "denúncia", "cpi",
    "morte", "tragédia", "colapso", "abandono", "negligência"
]


# ═══════════════════════════════════════════════════════════════════════════════
#  UTILITÁRIOS
# ═══════════════════════════════════════════════════════════════════════════════

def limpar_texto(texto):
    if not texto:
        return "sem texto"
    texto = re.sub(r"http\S+", "", texto)
    texto = re.sub(r"[^\w\s\.,!?;:\-áéíóúàâêôãõüçÁÉÍÓÚÀÂÊÔÃÕÜÇ@]", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto or "sem texto"


def formatar_data(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return ts or ""


def categoria_perfil(autor):
    return PERFIS_CATEGORIAS.get(autor.lower(), "Outro")


def e_relevante_para_radar(texto, autor):
    t = texto.lower()
    if autor.lower() in PERFIS_GESTAO:
        return any(k in t for k in KEYWORDS_GESTAO)
    tem_ancora = any(k in t for k in KEYWORDS_ANCORA)
    if not tem_ancora:
        return False
    if "gustavo" in t:
        return any(k in t for k in KEYWORDS_GESTAO)
    tem_gestao   = any(k in t for k in KEYWORDS_GESTAO)
    tem_contexto = any(k in t for k in KEYWORDS_CONTEXTO)
    return tem_gestao or tem_contexto


def calcular_score_risco(analise, curtidas, n_comentarios, tem_crise_keywords):
    """
    Score de risco composto 0-100 baseado em múltiplos fatores.
    Permite ordenar posts por criticidade real.
    """
    score = 0

    # Risco base declarado pelo Claude (0-40 pts)
    risco = analise.get("risco_crise", "Baixo")
    score += {"Alto": 40, "Médio": 20, "Baixo": 5}.get(risco, 5)

    # Urgência (0-25 pts)
    urgencia = analise.get("urgencia", "Baixa")
    score += {"Alta": 25, "Média": 12, "Baixa": 3}.get(urgencia, 3)

    # Tendência (0-15 pts)
    tendencia = analise.get("tendencia", "Estável")
    score += {"Crescendo": 15, "Estável": 5, "Diminuindo": 0}.get(tendencia, 5)

    # Engajamento real (0-10 pts)
    total_interacoes = curtidas + n_comentarios
    if total_interacoes > 500:
        score += 10
    elif total_interacoes > 100:
        score += 6
    elif total_interacoes > 20:
        score += 3

    # Tema sensível (0-5 pts)
    if analise.get("tema_sensivel") == "Sim":
        score += 5

    # Keywords de crise no caption (0-5 pts)
    if tem_crise_keywords:
        score += 5

    return min(score, 100)


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE SHEETS — PLANILHA PRINCIPAL E MEMÓRIA
# ═══════════════════════════════════════════════════════════════════════════════

def conectar_sheets():
    creds = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    gc = gspread.authorize(creds)
    return gc.open_by_key(GOOGLE_SHEET_ID)


def garantir_aba(sh, nome, headers):
    try:
        ws = sh.worksheet(nome)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(nome, rows=1000, cols=len(headers) + 2)
        ws.append_row(headers)
        print(f"  Aba '{nome}' criada.")
    if not ws.row_values(1):
        ws.append_row(headers)
    return ws


def abrir_planilha(sh):
    try:
        ws = sh.worksheet(GOOGLE_SHEET_NAME)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(GOOGLE_SHEET_NAME, rows=2000, cols=30)

    cabecalho_atual = ws.row_values(1)
    if cabecalho_atual != SHEET_HEADERS:
        # Migração suave: apenas adiciona colunas novas sem apagar dados
        if not cabecalho_atual:
            ws.append_row(SHEET_HEADERS)
        else:
            for i, h in enumerate(SHEET_HEADERS):
                if i >= len(cabecalho_atual) or cabecalho_atual[i] != h:
                    ws.update_cell(1, i + 1, h)
    return ws


def urls_existentes(ws):
    valores = ws.col_values(1)
    return set(valores[1:])


# ═══════════════════════════════════════════════════════════════════════════════
#  MEMÓRIA CONTEXTUAL — CARREGA HISTÓRICO DOS ÚLTIMOS 7 DIAS
# ═══════════════════════════════════════════════════════════════════════════════

def carregar_contexto_historico(sh):
    """
    Carrega os últimos 7 dias da aba Radar e produz um resumo contextual
    que será injetado no prompt do Claude como memória de curto prazo.
    """
    try:
        ws_radar = sh.worksheet(GOOGLE_SHEET_NAME)
        dados = ws_radar.get_all_records()
    except Exception:
        return {}, ""

    if not dados:
        return {}, ""

    # Filtra últimos 7 dias
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    recentes = []
    for row in dados:
        try:
            data_str = str(row.get("data_post", ""))
            data = datetime.strptime(data_str, "%d/%m/%Y %H:%M").replace(tzinfo=timezone.utc)
            if data >= cutoff:
                recentes.append(row)
        except Exception:
            continue

    if not recentes:
        return {}, "Sem histórico recente disponível."

    # Agrega por perfil e tema
    por_perfil = {}
    temas_count = {}
    crises_recentes = []

    for r in recentes:
        autor = r.get("autor", "")
        tema  = r.get("tema", "")
        risco = r.get("risco_crise", "")
        urgencia = r.get("urgencia", "")
        score = r.get("score_risco", 0)

        if autor not in por_perfil:
            por_perfil[autor] = {"posts": 0, "alto_risco": 0, "temas": [], "ultima_urgencia": ""}
        por_perfil[autor]["posts"] += 1
        if risco == "Alto":
            por_perfil[autor]["alto_risco"] += 1
        if tema:
            por_perfil[autor]["temas"].append(tema)
        por_perfil[autor]["ultima_urgencia"] = urgencia

        temas_count[tema] = temas_count.get(tema, 0) + 1

        if risco == "Alto" or urgencia == "Alta":
            crises_recentes.append({
                "autor": autor,
                "tema": tema,
                "resumo": r.get("resumo", ""),
                "sugestao": r.get("sugestao_acao", ""),
                "score": score,
            })

    # Perfis reincidentes (3+ posts na semana)
    reincidentes = {p: d for p, d in por_perfil.items() if d["posts"] >= 3}

    # Temas dominantes
    temas_dominantes = sorted(temas_count.items(), key=lambda x: x[1], reverse=True)[:3]

    # Monta resumo em texto para o Claude
    linhas_contexto = [
        f"=== CONTEXTO POLÍTICO DOS ÚLTIMOS 7 DIAS ===",
        f"Total de posts analisados: {len(recentes)}",
        "",
    ]

    if temas_dominantes:
        linhas_contexto.append("TEMAS DOMINANTES NA SEMANA:")
        for tema, count in temas_dominantes:
            linhas_contexto.append(f"  - {tema}: {count} posts")
        linhas_contexto.append("")

    if reincidentes:
        linhas_contexto.append("PERFIS MAIS ATIVOS (3+ posts):")
        for perfil, dados in reincidentes.items():
            temas_unicos = list(set(dados["temas"]))[:3]
            linhas_contexto.append(
                f"  - @{perfil}: {dados['posts']} posts | "
                f"Alto risco: {dados['alto_risco']}x | "
                f"Temas: {', '.join(temas_unicos)}"
            )
        linhas_contexto.append("")

    if crises_recentes:
        linhas_contexto.append("CRISES/ALERTAS RECENTES:")
        for c in sorted(crises_recentes, key=lambda x: x.get("score", 0), reverse=True)[:5]:
            linhas_contexto.append(
                f"  - @{c['autor']} | {c['tema']} | "
                f"{c['resumo']} | Ação: {c['sugestao']}"
            )
        linhas_contexto.append("")

    contexto_texto = "\n".join(linhas_contexto)
    return por_perfil, contexto_texto


def carregar_feedback_aprendido(sh):
    """
    Carrega feedbacks do assessor para personalizar o prompt.
    Extrai padrões: quais tipos de análise foram marcadas como úteis.
    """
    try:
        ws_fb = sh.worksheet(SHEET_FEEDBACK)
        dados = ws_fb.get_all_records()
    except Exception:
        return ""

    if not dados:
        return ""

    uteis = [r for r in dados if str(r.get("feedback", "")).lower() == "útil"]
    inuteis = [r for r in dados if str(r.get("feedback", "")).lower() == "inútil"]

    if not uteis and not inuteis:
        return ""

    linhas = ["\n=== APRENDIZADO DO ASSESSOR ==="]

    if uteis:
        # Agrupa ações úteis por tema
        acoes_uteis = {}
        for r in uteis:
            key = f"{r.get('tema', '')}:{r.get('sugestao_acao', '')}"
            acoes_uteis[key] = acoes_uteis.get(key, 0) + 1
        top_uteis = sorted(acoes_uteis.items(), key=lambda x: x[1], reverse=True)[:3]
        linhas.append("Tipos de análise que o assessor marcou como ÚTEIS:")
        for acao, count in top_uteis:
            tema, sugestao = acao.split(":", 1)
            linhas.append(f"  ✓ Tema {tema} → Ação '{sugestao}' ({count}x aprovada)")

    if inuteis:
        acoes_inuteis = {}
        for r in inuteis:
            key = f"{r.get('tema', '')}:{r.get('sugestao_acao', '')}"
            acoes_inuteis[key] = acoes_inuteis.get(key, 0) + 1
        top_inuteis = sorted(acoes_inuteis.items(), key=lambda x: x[1], reverse=True)[:3]
        linhas.append("Tipos de análise que o assessor marcou como NÃO ÚTEIS (evitar):")
        for acao, count in top_inuteis:
            tema, sugestao = acao.split(":", 1)
            linhas.append(f"  ✗ Tema {tema} → Ação '{sugestao}' ({count}x reprovada)")

    return "\n".join(linhas)


def registrar_padrao(sh, post, analise):
    """
    Registra automaticamente padrões detectados na aba Padroes.
    Ex: perfil X sempre posta sobre tema Y às sextas com alto engajamento.
    """
    try:
        ws_p = sh.worksheet(SHEET_PADROES)
        dados_existentes = ws_p.get_all_records()

        autor = post["autor"]
        tema  = analise.get("tema", "")
        try:
            dt = datetime.strptime(post["data_post"], "%d/%m/%Y %H:%M")
            dia_semana = dt.strftime("%A")
            hora = dt.hour
        except Exception:
            dia_semana = "?"
            hora = 0

        # Verifica se já existe padrão para este perfil+tema
        existente = next(
            (r for r in dados_existentes
             if r.get("perfil") == autor and r.get("tema") == tema),
            None
        )

        engajamento = post["curtidas"] + post["comentarios_count"]

        if existente:
            # Atualiza frequência
            nova_freq = int(existente.get("frequencia_semanal", 1)) + 1
            idx = dados_existentes.index(existente) + 2
            ws_p.update_cell(idx, 8, nova_freq)
            ws_p.update_cell(idx, 1, datetime.now().strftime("%d/%m/%Y %H:%M"))
        else:
            # Registra novo padrão
            ws_p.append_row([
                datetime.now().strftime("%d/%m/%Y %H:%M"),
                autor,
                tema,
                dia_semana,
                hora,
                engajamento,
                analise.get("sentimento_post", ""),
                1,
                f"Primeira ocorrência detectada automaticamente"
            ])
    except Exception as e:
        print(f"  Aviso: erro ao registrar padrão — {e}")


def registrar_memoria(sh, post, analise, score_risco):
    """
    Registra na aba Memoria_Contexto eventos de alto risco
    para que o agente aprenda com crises passadas.
    """
    if score_risco < 60:
        return  # Só registra eventos significativos

    try:
        ws_m = sh.worksheet(SHEET_MEMORIA)
        ws_m.append_row([
            datetime.now().strftime("%d/%m/%Y %H:%M"),
            "crise" if score_risco >= 80 else "alerta",
            post["autor"],
            analise.get("tema", ""),
            f"{analise.get('resumo', '')} | Ação: {analise.get('sugestao_acao', '')}",
            1,
            datetime.now().strftime("%d/%m/%Y %H:%M"),
            "alta" if score_risco >= 80 else "média"
        ])
    except Exception as e:
        print(f"  Aviso: erro ao registrar memória — {e}")


# ═══════════════════════════════════════════════════════════════════════════════
#  APIFY
# ═══════════════════════════════════════════════════════════════════════════════

def disparar_actor(actor_id, input_data, timeout=300):
    print(f"  Disparando {actor_id}...")
    actor_slug = actor_id.replace("/", "~")
    url = f"https://api.apify.com/v2/acts/{actor_slug}/runs?token={APIFY_API_TOKEN}"
    resp = requests.post(url, json=input_data, timeout=30)
    resp.raise_for_status()
    run_id = resp.json()["data"]["id"]
    print(f"  Run iniciado: {run_id}")

    inicio = time.time()
    while True:
        time.sleep(10)
        r = requests.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}?token={APIFY_API_TOKEN}",
            timeout=15
        )
        r.raise_for_status()
        data   = r.json()["data"]
        status = data["status"]
        print(f"  Status: {status}")

        if status == "SUCCEEDED":
            dataset_id = data["defaultDatasetId"]
            print(f"  Dataset ID: {dataset_id}")
            return dataset_id
        if status in ("FAILED", "ABORTED", "TIMED-OUT"):
            raise RuntimeError(f"Actor {actor_id} terminou com status: {status}")
        if time.time() - inicio > timeout:
            raise TimeoutError(f"Actor {actor_id} excedeu {timeout}s.")


def buscar_items(dataset_id):
    url = (
        f"https://api.apify.com/v2/datasets/{dataset_id}/items"
        f"?token={APIFY_API_TOKEN}&format=json&clean=true"
    )
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def coletar_comentarios(urls_posts):
    if not urls_posts:
        return {}
    print(f"\n  Coletando comentários de {len(urls_posts)} posts...")

    try:
        dataset_id = disparar_actor(APIFY_COMMENT_ACTOR_ID, {
            "directUrls": urls_posts,
            "resultsLimit": 500,
            "includeReplies": True,
        }, timeout=300)
        items = buscar_items(dataset_id)
    except Exception as e:
        print(f"  Aviso: falha ao coletar comentários — {e}")
        return {}

    mapa = {}
    ignorados = 0
    for item in items:
        post_url = (item.get("postUrl") or item.get("url") or "").rstrip("/")
        texto    = item.get("text") or item.get("comment") or ""
        username = item.get("ownerUsername") or item.get("username") or "anon"
        if not post_url or not texto:
            continue
        texto_limpo  = limpar_texto(texto)
        tem_conteudo = len(texto_limpo) > 10
        tem_politica = any(k in texto_limpo.lower() for k in KEYWORDS_CONTEXTO)
        if tem_politica or (tem_conteudo and any(k in texto_limpo.lower() for k in KEYWORDS_GESTAO)):
            mapa.setdefault(post_url, []).append(f"{username}: {texto_limpo}")
        else:
            ignorados += 1

    total = sum(len(v) for v in mapa.values())
    print(f"  {len(items)} brutos → {total} relevantes em {len(mapa)} posts ({ignorados} ignorados).")
    return mapa


# ═══════════════════════════════════════════════════════════════════════════════
#  CLAUDE SONNET — ANÁLISE COM CONTEXTO HISTÓRICO
# ═══════════════════════════════════════════════════════════════════════════════

AGENT_PROMPT = """\
Você é o AGENTE RADAR POLÍTICO de Alagoinhas/BA — um analista político sênior especializado em monitoramento de redes sociais, gestão de crises e assessoria estratégica para o prefeito Gustavo Carmo e sua equipe de comunicação.

Sua análise deve ser ESTRATÉGICA e ACIONÁVEL — não apenas descritiva. O assessor precisa saber EXATAMENTE o que fazer com a informação que você entregar.

{contexto_historico}
{aprendizado}

═══════════════════════════════════════════════
POST A ANALISAR
═══════════════════════════════════════════════
Perfil: @{autor} ({categoria})
Engajamento: {curtidas} curtidas | {comentarios_count} comentários no Instagram
Data: {data_post}

Conteúdo do post:
{caption}

{bloco_comentarios}

═══════════════════════════════════════════════
INSTRUÇÕES DE ANÁLISE
═══════════════════════════════════════════════
1. Use o CONTEXTO HISTÓRICO para identificar se este post faz parte de um padrão ou campanha coordenada
2. Considere o APRENDIZADO DO ASSESSOR para calibrar sua sugestão de ação
3. O score_risco deve refletir a criticidade REAL, não apenas o sentimento imediato
4. A sugestao_acao deve ser específica e executável nas próximas horas
5. Se o post for da oposição, analise se é movimento isolado ou parte de campanha

Retorne SOMENTE um JSON válido, sem texto extra, sem markdown:

{{
  "sentimento_post": "Positivo" | "Negativo" | "Neutro",
  "sentimento_comentarios": "Positivo" | "Negativo" | "Neutro" | "Sem comentários",
  "comentarios_negativos_pct": "<ex: 35%>",
  "comentarios_positivos_pct": "<ex: 45%>",
  "comentarios_positivos_texto": "<até 3 comentários positivos reais separados por | >",
  "comentarios_negativos_texto": "<até 3 comentários negativos reais separados por | >",
  "comentarios_destaque": "<o comentário mais impactante politicamente>",
  "tema": "Saúde" | "Obras" | "Educação" | "Segurança" | "Política" | "Social" | "Transporte" | "Meio Ambiente" | "Outro",
  "tema_sensivel": "Sim" | "Não",
  "urgencia": "Alta" | "Média" | "Baixa",
  "risco_crise": "Alto" | "Médio" | "Baixo",
  "tendencia": "Crescendo" | "Estável" | "Diminuindo",
  "engajamento": "Alto" | "Médio" | "Baixo",
  "resumo": "<resumo em até 15 palavras>",
  "atribuicao": "<a quem o post se refere>",
  "sugestao_acao": "Monitorar" | "Responder publicamente" | "Acionar assessoria" | "Conter crise" | "Ampliar positivo",
  "justificativa_acao": "<por que essa ação em até 20 palavras>",
  "padrao_detectado": "<se faz parte de padrão ou campanha, descreva; senão: 'Isolado'>",
  "janela_acao": "<quando agir: ex: 'próximas 2h', 'até 18h de hoje', 'monitorar 24h'>"
}}

Critérios de urgência:
- Alta: risco real de crise nas próximas horas (denúncia grave, escândalo, morte, mobilização)
- Média: situação que pode escalar se não tratada em 24h
- Baixa: informativo, positivo ou sem potencial de crise

Critérios de risco_crise:
- Alto: comentários negativos crescentes + tema sensível + oposição ativa
- Médio: algum risco mas controlável com ação adequada
- Baixo: situação favorável ou neutra"""


def analisar_post_agente(post, comentarios_lista, contexto_historico, aprendizado):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    total        = len(comentarios_lista)
    comentaristas = ", ".join(sorted(set(
        c.split(":")[0].strip() for c in comentarios_lista[:20] if ":" in c
    ))[:10]) or "nenhum"

    if comentarios_lista:
        bloco_comentarios = (
            f"Comentários analisados ({total} de: {comentaristas}):\n" +
            "\n".join(f"- {c}" for c in comentarios_lista)
        )
    else:
        bloco_comentarios = "Comentários: Nenhum comentário relevante coletado."

    prompt = AGENT_PROMPT.format(
        contexto_historico=contexto_historico,
        aprendizado=aprendizado,
        autor=post["autor"],
        categoria=post["categoria"],
        curtidas=post["curtidas"],
        comentarios_count=post["comentarios_count"],
        data_post=post["data_post"],
        caption=post["caption"],
        bloco_comentarios=bloco_comentarios,
    )

    msg = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r"```(?:json)?|```", "", raw).strip()
    return json.loads(raw)


# ═══════════════════════════════════════════════════════════════════════════════
#  PIPELINE PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

def processar():
    print("=" * 65)
    print("RADAR POLÍTICO AGENTE — Alagoinhas/BA")
    print(f"Execução: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print("=" * 65)

    # Conecta ao Sheets e garante abas de memória
    print("\n[0/6] Conectando ao Google Sheets e memória...")
    sh = conectar_sheets()
    ws_radar    = abrir_planilha(sh)
    ws_feedback = garantir_aba(sh, SHEET_FEEDBACK, FEEDBACK_HEADERS)
    ws_memoria  = garantir_aba(sh, SHEET_MEMORIA, MEMORIA_HEADERS)
    ws_padroes  = garantir_aba(sh, SHEET_PADROES, PADROES_HEADERS)
    existentes  = urls_existentes(ws_radar)
    print(f"  {len(existentes)} posts já analisados na base.")

    # Carrega contexto histórico e aprendizado
    print("\n[1/6] Carregando contexto histórico e aprendizado...")
    por_perfil, contexto_historico = carregar_contexto_historico(sh)
    aprendizado = carregar_feedback_aprendido(sh)
    n_perfis_ativos = len([p for p, d in por_perfil.items() if d.get("posts", 0) >= 2])
    print(f"  Contexto: {len(por_perfil)} perfis monitorados | {n_perfis_ativos} ativos na semana")
    print(f"  Aprendizado: {'Sim' if aprendizado else 'Ainda sem feedback do assessor'}")

    # Coleta posts
    print("\n[2/6] Coletando posts do Instagram...")
    try:
        post_dataset_id = disparar_actor(APIFY_POST_ACTOR_ID, {
            "username": PERFIS,
            "resultsLimit": 20,
            "onlyPostsNewerThan": "1 day",
            "skipPinnedPosts": False,
        }, timeout=300)
        posts = buscar_items(post_dataset_id)
    except Exception as e:
        print(f"Erro ao coletar posts: {e}")
        sys.exit(1)

    print(f"  {len(posts)} posts recebidos.")
    if not posts:
        print("Nenhum post encontrado. Encerrando.")
        return

    # Filtra posts relevantes
    print("\n[3/6] Filtrando posts relevantes...")
    posts_filtrados = []
    for post in posts:
        url     = (post.get("url") or post.get("shortCode") or "").rstrip("/")
        caption = limpar_texto(post.get("caption") or post.get("text") or "")
        autor   = post.get("ownerUsername") or post.get("authorUsername") or ""

        if url in existentes:
            continue
        if not e_relevante_para_radar(caption, autor):
            continue

        tem_crise = any(k in caption.lower() for k in KEYWORDS_CRISE)

        posts_filtrados.append({
            "url":              url,
            "caption":          caption,
            "autor":            autor,
            "categoria":        categoria_perfil(autor),
            "data_post":        formatar_data(post.get("timestamp") or post.get("createdAt") or ""),
            "curtidas":         int(post.get("likesCount") or post.get("likes") or 0),
            "comentarios_count": int(post.get("commentsCount") or post.get("comments") or 0),
            "tem_crise_keywords": tem_crise,
        })

    # Ordena: oposição e crise primeiro
    posts_filtrados.sort(key=lambda p: (
        0 if p["categoria"] == "Oposição" else
        1 if p["tem_crise_keywords"] else 2
    ))

    print(f"  {len(posts_filtrados)} posts relevantes e novos.")
    if not posts_filtrados:
        print("Nenhum post novo para processar. Encerrando.")
        return

    # Coleta comentários
    print("\n[4/6] Coletando comentários...")
    urls_http = [p["url"] for p in posts_filtrados if p["url"].startswith("http")]
    mapa_comentarios = coletar_comentarios(urls_http)

    # Analisa com Claude Sonnet + contexto e grava
    print("\n[5/6] Analisando com Claude Sonnet (contexto histórico ativo)...")
    linhas = []
    novos  = 0
    erros  = 0
    alertas_crise = []

    for post in posts_filtrados:
        url              = post["url"]
        comentarios_lista = mapa_comentarios.get(url, [])

        try:
            analise = analisar_post_agente(
                post, comentarios_lista,
                contexto_historico, aprendizado
            )
        except Exception as e:
            print(f"  ✗ Erro ao analisar {url}: {e}")
            erros += 1
            continue

        # Score de risco composto
        score = calcular_score_risco(
            analise,
            post["curtidas"],
            len(comentarios_lista),
            post["tem_crise_keywords"]
        )

        # Comentaristas únicos
        comentaristas_unicos = ", ".join(sorted(set(
            c.split(":")[0].strip() for c in comentarios_lista if ":" in c
        ))[:10])

        # Coleta alertas de crise para log final
        if score >= 70:
            alertas_crise.append({
                "autor": post["autor"],
                "tema":  analise.get("tema", ""),
                "resumo": analise.get("resumo", ""),
                "score": score,
                "acao":  analise.get("sugestao_acao", ""),
                "janela": analise.get("janela_acao", ""),
                "padrao": analise.get("padrao_detectado", ""),
            })

        linha = [
            url,
            post["data_post"],
            post["autor"],
            post["categoria"],
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
            score,
            analise.get("tendencia", ""),
            analise.get("engajamento", ""),
            analise.get("resumo", ""),
            analise.get("atribuicao", ""),
            analise.get("sugestao_acao", ""),
            analise.get("justificativa_acao", ""),
            analise.get("padrao_detectado", ""),
        ]
        linhas.append(linha)
        existentes.add(url)
        novos += 1

        # Registra padrões e memória automaticamente
        registrar_padrao(sh, post, analise)
        registrar_memoria(sh, post, analise, score)

        emoji = "🚨" if score >= 70 else "⚠️" if score >= 40 else "✓"
        print(
            f"  {emoji} [{post['categoria']}] @{post['autor']} | "
            f"{analise.get('tema')} | Score: {score} | "
            f"{analise.get('sugestao_acao')} | {len(comentarios_lista)} comentários"
        )

    # Grava em batch
    if linhas:
        ws_radar.append_rows(linhas, value_input_option="USER_ENTERED")

    # Prepara aba Feedback com posts novos (para o assessor avaliar)
    print("\n[6/6] Preparando registros de feedback...")
    for linha in linhas:
        url_post = linha[0]
        # Adiciona linha de feedback em branco para o assessor preencher
        ws_feedback.append_row([
            url_post,
            datetime.now().strftime("%d/%m/%Y %H:%M"),
            linha[2],   # autor
            linha[15],  # tema
            linha[17],  # urgencia
            linha[24],  # sugestao_acao
            "",         # feedback (assessor preenche: "útil" ou "inútil")
            "",         # data_feedback
            "",         # observacao
        ])

    # Relatório final
    print(f"\n{'='*65}")
    print(f"CONCLUÍDO: {novos} novos | {erros} erros")

    if alertas_crise:
        print(f"\n🚨 {len(alertas_crise)} ALERTAS DE CRISE (score ≥ 70):")
        for a in sorted(alertas_crise, key=lambda x: x["score"], reverse=True):
            print(f"  @{a['autor']} | {a['tema']} | Score: {a['score']}")
            print(f"  Resumo: {a['resumo']}")
            print(f"  Ação: {a['acao']} | Janela: {a['janela']}")
            if a["padrao"] != "Isolado":
                print(f"  ⚡ Padrão: {a['padrao']}")
            print()
    else:
        print("  Nenhum alerta de crise nesta execução.")

    print(f"{'='*65}")


if __name__ == "__main__":
    processar()
