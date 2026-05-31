"""
╔══════════════════════════════════════════════════════════════════╗
║  ÁGORA — Agente de Monitoramento Político                        ║
║  Radar Político Alagoinhas                                       ║
║                                                                  ║
║  Pipeline:                                                       ║
║    SociaVault → Comentários → Memória → Claude Sonnet            ║
║    → Sheets → WhatsApp                                           ║
║                                                                  ║
║  Execução: GitHub Actions 4x/dia                                 ║
║  Autor: Robério / robermed-tech                                  ║
╚══════════════════════════════════════════════════════════════════╝
"""

import os
import json
import time
import requests
from datetime import datetime, timedelta
from anthropic import Anthropic
import gspread
from google.oauth2.service_account import Credentials

# ══════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO
# ══════════════════════════════════════════════════════════════════

SOCIAVAULT_KEY   = os.environ["SOCIAVAULT_API_KEY"]
ANTHROPIC_KEY    = os.environ["ANTHROPIC_API_KEY"]
SPREADSHEET_ID   = os.environ["SPREADSHEET_ID"]
EVOLUTION_URL    = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_KEY    = os.environ.get("EVOLUTION_API_KEY", "")
WHATSAPP_NUMBER  = os.environ.get("WHATSAPP_NUMBER", "")

SOCIAVAULT_BASE  = "https://api.sociavault.com"
SOCIAVAULT_HDR   = {"X-API-Key": SOCIAVAULT_KEY}

# Perfis monitorados — 14 perfis em 3 categorias
PERFIS = {
    # Governo
    "gustavoascarmo":       {"categoria": "Prefeito",   "filtro": "governo"},
    "prefeituraalagoinhas": {"categoria": "Prefeitura", "filtro": "governo"},
    # Oposição
    "soulucianoalmeida":    {"categoria": "Oposição",   "filtro": "oposicao"},
    "oficialjoaquimneto":   {"categoria": "Oposi��o",   "filtro": "oposicao"},
    "paulocezar_oficial":   {"categoria": "Oposi��o",   "filtro": "oposicao"},
    "jaldicenunes":         {"categoria": "Oposi��o",   "filtro": "oposicao"},
    "eulumamenezes":        {"categoria": "Oposi��o",   "filtro": "oposicao"},
    "gleysersoares":        {"categoria": "Oposi��o",   "filtro": "oposicao"},
    "jornalalagoinhas":     {"categoria": "Imprensa",   "filtro": "imprensa"},
    "suacidade":            {"categoria": "Imprensa",   "filtro": "imprensa"},
    # Imprensa
    "alagonews":            {"categoria": "Imprensa",   "filtro": "imprensa"},
    "portalalagoinhasnews": {"categoria": "Imprensa",   "filtro": "imprensa"},
    "seligaalagoinhas":     {"categoria": "Imprensa",   "filtro": "imprensa"},
    "alagoinhas24h":        {"categoria": "Imprensa",   "filtro": "imprensa"},
}

# Palavras-chave de relevância por filtro
KEYWORDS_GOVERNO  = ["prefeitura", "prefeito", "gustavo", "gestão", "alagoinhas",
                     "obra", "serviço", "municipal", "secretaria", "secom"]
KEYWORDS_OPOSICAO = ["prefeitura", "prefeito", "gustavo carmo", "gestão municipal",
                     "alagoinhas", "administração"]
KEYWORDS_IMPRENSA = ["prefeitura de alagoinhas", "gustavo carmo", "gestão municipal",
                     "prefeito de alagoinhas"]

# Score de alerta
SCORE_IMAGEM_ALERTA = 30   # ≤ 30 → crise de imagem
SCORE_RISCO_ALERTA  = 70   # ≥ 70 → risco alto

# Limites de coleta
MAX_POSTS_POR_PERFIL    = 5
MAX_PAGINAS_COMENTARIOS = 3   # ~45 comentários por post
DIAS_RETROATIVOS        = 2

# ══════════════════════════════════════════════════════════════════
# MÓDULO 0 — UTILITÁRIOS
# ══════════════════════════════════════════════════════════════════

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")

def timestamp_para_data(ts):
    """Converte Unix timestamp ou string ISO para dd/mm/yyyy."""
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts).strftime("%d/%m/%Y")
        if isinstance(ts, str):
            # ISO 8601
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y")
    except Exception:
        pass
    return datetime.now().strftime("%d/%m/%Y")

def extrair(obj, *chaves, padrao=""):
    """Tenta múltiplos nomes de campo — robusto a variações do JSON."""
    for chave in chaves:
        if chave in obj and obj[chave] is not None:
            return obj[chave]
    return padrao

def extrair_caption(caption_raw):
    """Caption da SociaVault é um dict com campo 'text'."""
    if isinstance(caption_raw, dict):
        return caption_raw.get("text", "")
    return str(caption_raw) if caption_raw else ""

def dentro_do_periodo(data_str, dias=DIAS_RETROATIVOS):
    """Verifica se a data está dentro do período retroativo."""
    try:
        partes = data_str.split("/")
        dt = datetime(int(partes[2]), int(partes[1]), int(partes[0]))
        return dt >= datetime.now() - timedelta(days=dias)
    except Exception:
        return True  # dúvida: inclui

def filtrar_relevante(caption, categoria_filtro):
    """Filtro de 3 camadas por categoria."""
    texto = caption.lower()
    if categoria_filtro == "governo":
        return any(kw in texto for kw in KEYWORDS_GOVERNO)
    if categoria_filtro == "oposicao":
        return any(kw in texto for kw in KEYWORDS_OPOSICAO)
    if categoria_filtro == "imprensa":
        return any(kw in texto for kw in KEYWORDS_IMPRENSA)
    return True

def conectar_sheets():
    """Conecta ao Google Sheets via service account."""
    creds_json = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not creds_json:
        raise ValueError("GOOGLE_CREDENTIALS não configurado")
    creds_dict = json.loads(creds_json)
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds  = Credentials.from_service_account_info(creds_dict, scopes=scopes)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID)

def garantir_aba(planilha, nome, cabecalho):
    """Garante que a aba existe com o cabeçalho correto."""
    try:
        aba = planilha.worksheet(nome)
        primeira = aba.row_values(1)
        if primeira != cabecalho:
            aba.insert_row(cabecalho, index=1)
        return aba
    except gspread.exceptions.WorksheetNotFound:
        aba = planilha.add_worksheet(title=nome, rows=5000, cols=len(cabecalho))
        aba.append_row(cabecalho)
        log(f"  ✅ Aba '{nome}' criada")
        return aba

# ══════════════════════════════════════════════════════════════════
# MÓDULO 1 — COLETA DE POSTS
# ══════════════════════════════════════════════════════════════════

def coletar_posts():
    """
    Busca os últimos posts de cada perfil via SociaVault.
    Retorna lista de posts com metadados normalizados.
    """
    log("━━━ MÓDULO 1 — Coletando posts ━━━")
    todos_posts = []
    creditos_usados = 0

    for handle, info in PERFIS.items():
        categoria = info["categoria"]
        filtro    = info["filtro"]
        log(f"  → @{handle} ({categoria})")

        try:
            r = requests.get(
                f"{SOCIAVAULT_BASE}/v1/scrape/instagram/posts",
                headers=SOCIAVAULT_HDR,
                params={"handle": handle},
                timeout=30
            )
            if r.status_code != 200:
                log(f"    ⚠️  Erro {r.status_code} em @{handle}")
                continue

            data = r.json()
            creditos_usados += data.get("credits_used", 1)

            inner     = data.get("data", {})
            items_raw = inner.get("items", inner.get("posts", []))
            if isinstance(items_raw, dict):
                posts_raw = list(items_raw.values())
            else:
                posts_raw = items_raw or []

            posts_filtrados = 0
            for p in posts_raw[:MAX_POSTS_POR_PERFIL]:
                # URL
                url = extrair(p, "url", "link", "permalink")
                if not url:
                    sc = extrair(p, "code", "shortcode", "pk")
                    url = f"https://www.instagram.com/p/{sc}/" if sc else ""
                if not url:
                    continue

                # Caption
                caption_raw = extrair(p, "caption", "text", "description")
                caption     = extrair_caption(caption_raw)

                # Data
                ts_raw = extrair(p, "taken_at", "timestamp", "created_at")
                data_post = timestamp_para_data(ts_raw)

                # Filtro de período
                if not dentro_do_periodo(data_post):
                    continue

                # Filtro de relevância (imprensa e oposição precisam mencionar prefeito)
                if filtro != "governo" and not filtrar_relevante(caption, filtro):
                    continue

                post = {
                    "url":            url,
                    "autor":          handle,
                    "categoria":      categoria,
                    "data_post":      data_post,
                    "curtidas":       int(extrair(p, "like_count", "likes", padrao=0)),
                    "total_coments":  int(extrair(p, "comment_count", "comments", padrao=0)),
                    "caption":        caption[:500],
                    "shortcode":      extrair(p, "code", "shortcode", padrao=""),
                }
                todos_posts.append(post)
                posts_filtrados += 1

            log(f"    {posts_filtrados} posts relevantes | {data.get('credits_used',1)} crédito(s)")
            time.sleep(0.5)  # respeita rate limit

        except Exception as e:
            log(f"    ❌ Erro em @{handle}: {e}")
            continue

    log(f"  📊 Total: {len(todos_posts)} posts | {creditos_usados} créditos usados")
    return todos_posts

# ══════════════════════════════════════════════════════════════════
# MÓDULO 2 — COLETA DE COMENTÁRIOS
# ══════════════════════════════════════════════════════════════════

def coletar_comentarios(posts):
    """
    Para cada post, coleta comentários individuais via SociaVault.
    Classifica autor como cidadao ou politico.
    Retorna dict {url_post: [comentarios]}.
    """
    log("━━━ MÓDULO 2 — Coletando comentários ━━━")
    handles_monitorados = set(PERFIS.keys())
    resultado           = {}
    creditos_usados     = 0

    for post in posts:
        url         = post["url"]
        total_known = post["total_coments"]

        # Pula posts sem comentários
        if total_known == 0:
            resultado[url] = []
            continue

        log(f"  → {post['autor']} | {total_known} comentários | {url[-30:]}")
        comentarios = []
        cursor      = None

        for pagina in range(1, MAX_PAGINAS_COMENTARIOS + 1):
            try:
                params = {"url": url}
                if cursor:
                    params["cursor"] = cursor

                r = requests.get(
                    f"{SOCIAVAULT_BASE}/v1/scrape/instagram/comments",
                    headers=SOCIAVAULT_HDR,
                    params=params,
                    timeout=30
                )

                if r.status_code != 200:
                    log(f"    ⚠️  Erro {r.status_code} na página {pagina}")
                    break

                data    = r.json()
                creditos_usados += data.get("credits_used", 1)
                inner   = data.get("data", {})
                raw     = inner.get("comments", [])

                if isinstance(raw, dict):
                    lista = list(raw.values())
                else:
                    lista = raw or []

                for c in lista:
                    if not isinstance(c, dict):
                        continue
                    texto    = c.get("text", "").strip()
                    if len(texto.split()) < 3:
                        continue  # filtra comentários de bot/emoji

                    username = c.get("user", {}).get("username", "")
                    tipo     = "politico" if username in handles_monitorados else "cidadao"

                    comentarios.append({
                        "id":         c.get("id", ""),
                        "texto":      texto[:300],
                        "username":   username,
                        "tipo":       tipo,
                        "curtidas":   int(c.get("comment_like_count", 0)),
                        "data":       c.get("created_at", "")[:10],
                    })

                cursor = inner.get("cursor")
                log(f"    Página {pagina}: {len(lista)} comentários | cursor: {'sim' if cursor else 'fim'}")
                if not cursor:
                    break
                time.sleep(0.4)

            except Exception as e:
                log(f"    ❌ Erro comentários página {pagina}: {e}")
                break

        resultado[url] = comentarios
        log(f"    ✅ {len(comentarios)} comentários coletados")
        time.sleep(0.5)

    log(f"  📊 Posts processados: {len(resultado)} | {creditos_usados} créditos usados")
    return resultado

# ══════════════════════════════════════════════════════════════════
# MÓDULO 3 — MEMÓRIA CONTEXTUAL
# ══════════════════════════════════════════════════════════════════

def carregar_memoria(planilha):
    """
    Lê as últimas linhas de Briefing_Diario e Feedback.
    Retorna bloco de texto para injetar no prompt do ÁGORA.
    """
    log("━━━ MÓDULO 3 — Carregando memória ━━━")
    blocos = []

    # Briefing dos últimos 7 dias
    try:
        aba     = planilha.worksheet("Briefing_Diario")
        linhas  = aba.get_all_records()
        recentes = linhas[-7:] if len(linhas) >= 7 else linhas
        if recentes:
            blocos.append("=== CONTEXTO POLÍTICO DOS ÚLTIMOS 7 DIAS ===")
            for l in recentes:
                data   = l.get("data", "")
                score  = l.get("score_medio_imagem", "")
                narr   = l.get("narrativa_dominante", "")
                queixa = l.get("queixa_top", "")
                blocos.append(f"• {data} | Score imagem: {score} | Narrativa: {narr} | Queixa: {queixa}")
    except Exception as e:
        log(f"  ⚠️  Briefing_Diario não encontrado: {e}")

    # Feedbacks recentes
    try:
        aba      = planilha.worksheet("Feedback")
        linhas   = aba.get_all_records()
        uteis    = [l for l in linhas if str(l.get("valor","")).lower() == "útil"][-5:]
        inuteis  = [l for l in linhas if str(l.get("valor","")).lower() == "inútil"][-5:]
        if uteis or inuteis:
            blocos.append("\n=== APRENDIZADO DE FEEDBACKS ANTERIORES ===")
            if uteis:
                blocos.append("Análises consideradas ÚTEIS pelo assessor (replique esse padrão):")
                for l in uteis:
                    blocos.append(f"  + URL: {l.get('url','')} | Contexto: {l.get('resumo','')}")
            if inuteis:
                blocos.append("Análises consideradas INÚTEIS (evite esse padrão):")
                for l in inuteis:
                    blocos.append(f"  - URL: {l.get('url','')} | Contexto: {l.get('resumo','')}")
    except Exception as e:
        log(f"  ⚠️  Feedback não encontrado: {e}")

    # Padrões detectados
    try:
        aba    = planilha.worksheet("Padroes")
        linhas = aba.get_all_records()
        ativos = [l for l in linhas if str(l.get("status","")).lower() == "ativo"][-3:]
        if ativos:
            blocos.append("\n=== PADRÕES ATIVOS DETECTADOS ===")
            for l in ativos:
                blocos.append(f"• {l.get('padrao','')}: detectado em {l.get('perfis_envolvidos','')}")
    except Exception:
        pass

    memoria = "\n".join(blocos) if blocos else "Sem histórico anterior disponível."
    log(f"  ✅ Memória carregada: {len(blocos)} blocos")
    return memoria

# ══════════════════════════════════════════════════════════════════
# MÓDULO 4 — ANÁLISE COM O ÁGORA (Claude Sonnet)
# ══════════════════════════════════════════════════════════════════

PROMPT_SISTEMA = """Você é o ÁGORA, agente de inteligência política especializado em monitorar
a imagem pública do prefeito Gustavo Carmo e da Prefeitura de Alagoinhas/BA.

Seu objetivo principal é analisar os COMENTÁRIOS dos cidadãos nos posts do Instagram,
pois a reação do cidadão comum é o verdadeiro termômetro da imagem do prefeito.
O post é apenas o gatilho — o que importa é o que o povo respondeu.

Regras de análise:
1. Priorize comentários de cidadãos comuns (tipo=cidadao) sobre perfis políticos
2. Identifique a queixa ou elogio mais frequente, não apenas o sentimento médio
3. Destaque o comentário mais representativo da opinião pública no período
4. Detecte padrões: mesma queixa em posts diferentes = pressão organizada
5. Seja preciso e direto — o assessor precisa de ação, não de análise genérica

Responda APENAS com JSON válido, sem markdown, sem texto antes ou depois."""

def montar_prompt(post, comentarios, memoria):
    """Monta o prompt de análise para um post com seus comentários."""
    # Agrupa comentários por tipo
    cidadaos  = [c for c in comentarios if c["tipo"] == "cidadao"]
    politicos = [c for c in comentarios if c["tipo"] == "politico"]

    # Ordena por curtidas (mais impactante primeiro)
    cidadaos_sorted  = sorted(cidadaos, key=lambda x: x["curtidas"], reverse=True)

    # Formata comentários para o prompt
    coments_txt = ""
    if cidadaos_sorted:
        coments_txt += f"\nCOMENTÁRIOS DE CIDADÃOS ({len(cidadaos_sorted)} total):\n"
        for c in cidadaos_sorted[:20]:  # até 20 comentários de cidadãos
            coments_txt += f'  ♥{c["curtidas"]} @{c["username"]}: "{c["texto"]}"\n'
    if politicos:
        coments_txt += f"\nCOMENTÁRIOS DE PERFIS POLÍTICOS ({len(politicos)} total):\n"
        for c in politicos[:5]:
            coments_txt += f'  @{c["username"]}: "{c["texto"]}"\n'

    prompt = f"""
{memoria}

═══════════════════════════════════════
POST PARA ANÁLISE
═══════════════════════════════════════
Perfil: @{post["autor"]} ({post["categoria"]})
Data: {post["data_post"]}
URL: {post["url"]}
Curtidas: {post["curtidas"]} | Comentários totais: {post["total_coments"]}
Caption: {post["caption"] or "(sem legenda)"}

{coments_txt if coments_txt else "Nenhum comentário coletado neste post."}

═══════════════════════════════════════
ANÁLISE SOLICITADA
═══════════════════════════════════════
Analise este post e seus comentários. Retorne APENAS este JSON:

{{
  "score_imagem": <0-100, onde 0=crise total, 100=aprovação máxima>,
  "score_risco": <0-100, onde 100=risco máximo para a gestão>,
  "sentimento_post": <"positivo"|"negativo"|"neutro">,
  "sentimento_comentarios": <"positivo"|"negativo"|"neutro"|"misto">,
  "queixa_dominante": "<queixa mais frequente nos comentários, ou vazio se não há>",
  "elogio_dominante": "<elogio mais frequente, ou vazio se não há>",
  "comentario_destaque": "<o comentário mais representativo da opinião pública>",
  "padrao_detectado": "<campanha coordenada, pressão organizada, ou vazio>",
  "tema": "<tema principal do post e comentários>",
  "urgencia": <"alta"|"media"|"baixa">,
  "sugestao_acao": "<ação concreta recomendada para a assessoria>",
  "janela_acao": "<tempo disponível para agir: imediato/24h/esta semana>"
}}"""
    return prompt

def analisar_com_agora(posts, comentarios_por_post, memoria):
    """
    Analisa cada post com Claude Sonnet.
    Retorna lista de posts enriquecidos com a análise do ÁGORA.
    """
    log("━━━ MÓDULO 4 — Analisando com o ÁGORA ━━━")
    cliente   = Anthropic(api_key=ANTHROPIC_KEY)
    resultado = []

    for i, post in enumerate(posts, 1):
        url        = post["url"]
        comentarios = comentarios_por_post.get(url, [])
        log(f"  [{i}/{len(posts)}] @{post['autor']} | {len(comentarios)} comentários")

        prompt = montar_prompt(post, comentarios, memoria)

        try:
            resposta = cliente.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1000,
                system=PROMPT_SISTEMA,
                messages=[{"role": "user", "content": prompt}]
            )
            texto = resposta.content[0].text.strip()

            # Remove markdown se vier
            if texto.startswith("```"):
                texto = texto.split("```")[1]
                if texto.startswith("json"):
                    texto = texto[4:]
            texto = texto.strip()

            analise = json.loads(texto)

            # Mescla post + análise
            post_enriquecido = {**post, **analise}
            post_enriquecido["total_cidadaos"]  = len([c for c in comentarios if c["tipo"] == "cidadao"])
            post_enriquecido["total_politicos"] = len([c for c in comentarios if c["tipo"] == "politico"])
            resultado.append(post_enriquecido)

            score_img  = analise.get("score_imagem", 50)
            score_risco = analise.get("score_risco", 0)
            log(f"    ✅ Score imagem: {score_img} | Risco: {score_risco} | {analise.get('sentimento_comentarios','')}")

        except json.JSONDecodeError as e:
            log(f"    ❌ JSON inválido: {e} | Resposta: {texto[:100]}")
            resultado.append({**post, "score_imagem": 50, "score_risco": 0,
                               "urgencia": "baixa", "tema": "", "sentimento_post": "neutro",
                               "sentimento_comentarios": "neutro"})
        except Exception as e:
            log(f"    ❌ Erro ÁGORA: {e}")
            resultado.append({**post, "score_imagem": 50, "score_risco": 0,
                               "urgencia": "baixa", "tema": "", "sentimento_post": "neutro",
                               "sentimento_comentarios": "neutro"})

        time.sleep(1)  # respeita rate limit Anthropic

    log(f"  📊 {len(resultado)} posts analisados pelo ÁGORA")
    return resultado

# ══════════════════════════════════════════════════════════════════
# MÓDULO 5 — GRAVAÇÃO NO SHEETS
# ══════════════════════════════════════════════════════════════════

CABECALHO_RADAR = [
    "url", "data_post", "autor", "categoria",
    "curtidas", "comentarios_total", "total_cidadaos", "total_politicos",
    "sentimento_post", "sentimento_comentarios",
    "score_imagem", "score_risco",
    "queixa_dominante", "elogio_dominante",
    "comentario_destaque", "padrao_detectado",
    "tema", "urgencia", "sugestao_acao", "janela_acao",
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
    """Grava posts analisados e comentários individuais no Sheets."""
    log("━━━ MÓDULO 5 — Gravando no Sheets ━━━")
    agora = datetime.now().strftime("%d/%m/%Y %H:%M")

    # ── Aba Radar ──────────────────────────────────────────────
    aba_radar = garantir_aba(planilha, "Radar", CABECALHO_RADAR)

    # URLs já existentes (deduplicação)
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
            p.get("url", ""),
            p.get("data_post", ""),
            p.get("autor", ""),
            p.get("categoria", ""),
            p.get("curtidas", 0),
            p.get("total_coments", 0),
            p.get("total_cidadaos", 0),
            p.get("total_politicos", 0),
            p.get("sentimento_post", ""),
            p.get("sentimento_comentarios", ""),
            p.get("score_imagem", 50),
            p.get("score_risco", 0),
            p.get("queixa_dominante", ""),
            p.get("elogio_dominante", ""),
            p.get("comentario_destaque", ""),
            p.get("padrao_detectado", ""),
            p.get("tema", ""),
            p.get("urgencia", ""),
            p.get("sugestao_acao", ""),
            p.get("janela_acao", ""),
            p.get("caption", "")[:200],
            agora,
        ]
        aba_radar.append_row(linha)
        existentes.add(p["url"])
        novos_radar += 1

    log(f"  ✅ Radar: {novos_radar} posts novos gravados")

    # ── Aba Comentarios_Analisados ─────────────────────────────
    aba_coments = garantir_aba(planilha, "Comentarios_Analisados", CABECALHO_COMENTARIOS)

    # IDs já existentes
    ids_existentes = set()
    try:
        todas_c = aba_coments.get_all_records()
        ids_existentes = {r.get("comentario_id", "") for r in todas_c}
    except Exception:
        pass

    novos_coments = 0
    for post in posts_analisados:
        url = post["url"]
        comentarios = comentarios_por_post.get(url, [])
        for c in comentarios:
            cid = c.get("id", "")
            if cid and cid in ids_existentes:
                continue
            linha_c = [
                url,
                post.get("autor", ""),
                post.get("categoria", ""),
                post.get("data_post", ""),
                cid,
                c.get("username", ""),
                c.get("tipo", ""),
                c.get("texto", ""),
                c.get("curtidas", 0),
                c.get("data", ""),
                agora,
            ]
            aba_coments.append_row(linha_c)
            if cid:
                ids_existentes.add(cid)
            novos_coments += 1

    log(f"  ✅ Comentarios_Analisados: {novos_coments} comentários novos gravados")
    return novos_radar, novos_coments

# ══════════════════════════════════════════════════════════════════
# MÓDULO 5b — BRIEFING DIÁRIO
# ══════════════════════════════════════════════════════════════════

def atualizar_briefing(planilha, posts_analisados, comentarios_por_post, alertas_enviados):
    """Grava o resumo do ciclo na aba Briefing_Diario."""
    log("━━━ MÓDULO 5b — Atualizando briefing ━━━")

    if not posts_analisados:
        log("  ⚠️  Nenhum post para resumir")
        return

    aba = garantir_aba(planilha, "Briefing_Diario", CABECALHO_BRIEFING)

    # Calcula métricas do ciclo
    scores_img   = [p.get("score_imagem", 50) for p in posts_analisados]
    scores_risco = [p.get("score_risco", 0)   for p in posts_analisados]
    score_medio_img  = round(sum(scores_img)   / len(scores_img),   1)
    score_medio_risco = round(sum(scores_risco) / len(scores_risco), 1)

    # Tema dominante
    temas = {}
    for p in posts_analisados:
        t = p.get("tema", "")
        if t:
            temas[t] = temas.get(t, 0) + 1
    narrativa = max(temas, key=temas.get) if temas else ""

    # Queixa top
    queixas = {}
    for p in posts_analisados:
        q = p.get("queixa_dominante", "")
        if q:
            queixas[q] = queixas.get(q, 0) + 1
    queixa_top = max(queixas, key=queixas.get) if queixas else ""

    # Perfil mais ativo
    perfis_c = {}
    for p in posts_analisados:
        a = p.get("autor", "")
        if a:
            perfis_c[a] = perfis_c.get(a, 0) + 1
    perfil_ativo = max(perfis_c, key=perfis_c.get) if perfis_c else ""

    # Urgências altas
    urg_alta = sum(1 for p in posts_analisados if p.get("urgencia") == "alta")

    # Total de comentários de cidadãos
    total_cid = sum(
        len([c for c in comentarios_por_post.get(p["url"], []) if c["tipo"] == "cidadao"])
        for p in posts_analisados
    )

    now = datetime.now()
    linha = [
        now.strftime("%d/%m/%Y"),
        now.strftime("%H:%M"),
        score_medio_img,
        score_medio_risco,
        len(posts_analisados),
        total_cid,
        narrativa,
        queixa_top,
        perfil_ativo,
        urg_alta,
        alertas_enviados,
    ]
    aba.append_row(linha)
    log(f"  ✅ Briefing gravado | Score imagem: {score_medio_img} | Risco: {score_medio_risco}")

# ══════════════════════════════════════════════════════════════════
# MÓDULO 6 — ALERTAS WHATSAPP
# ══════════════════════════════════════════════════════════════════

def formatar_mensagem_alerta(post):
    """Formata mensagem de alerta para WhatsApp."""
    score_img  = post.get("score_imagem", 50)
    score_risco = post.get("score_risco", 0)
    emoji = "🔴" if score_img <= 20 else "🟠"

    msg = f"""{emoji} *ALERTA ÁGORA — Radar Político Alagoinhas*

📍 *Perfil:* @{post.get("autor","")} ({post.get("categoria","")})
📅 *Data:* {post.get("data_post","")}
🔗 {post.get("url","")}

📊 *Score de Imagem:* {score_img}/100
⚠️ *Score de Risco:* {score_risco}/100

🔥 *Queixa dominante:*
_{post.get("queixa_dominante", "Não identificada")}_

💬 *Comentário destaque:*
_"{post.get("comentario_destaque", "")}"_

🎯 *Sugestão de ação:*
{post.get("sugestao_acao", "")}

⏱️ *Janela:* {post.get("janela_acao", "")}

_Mensagem automática do ÁGORA_"""
    return msg

def disparar_alertas(posts_analisados):
    """
    Dispara alertas WhatsApp via Evolution API
    quando score_imagem ≤ 30 ou score_risco ≥ 70.
    """
    log("━━━ MÓDULO 6 — Verificando alertas ━━━")

    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        log("  ⚠️  Evolution API não configurada — alertas desativados")
        return 0

    alertas_enviados = 0

    for post in posts_analisados:
        score_img   = post.get("score_imagem", 50)
        score_risco = post.get("score_risco", 0)

        deve_alertar = (score_img <= SCORE_IMAGEM_ALERTA or
                        score_risco >= SCORE_RISCO_ALERTA)

        if not deve_alertar:
            continue

        log(f"  🚨 Alerta: @{post['autor']} | Imagem: {score_img} | Risco: {score_risco}")
        mensagem = formatar_mensagem_alerta(post)

        try:
            r = requests.post(
                f"{EVOLUTION_URL}/message/sendText/{os.environ.get('EVOLUTION_INSTANCE','radar')}",
                headers={
                    "Content-Type": "application/json",
                    "apikey": EVOLUTION_KEY
                },
                json={
                    "number": WHATSAPP_NUMBER,
                    "options": {"delay": 1200, "presence": "composing"},
                    "textMessage": {"text": mensagem}
                },
                timeout=15
            )
            if r.status_code in (200, 201):
                log(f"    ✅ Alerta enviado para {WHATSAPP_NUMBER}")
                alertas_enviados += 1
            else:
                log(f"    ❌ Erro Evolution API: {r.status_code} | {r.text[:100]}")
        except Exception as e:
            log(f"    ❌ Erro ao enviar alerta: {e}")

        time.sleep(2)  # pausa entre alertas

    log(f"  📊 {alertas_enviados} alertas enviados")
    return alertas_enviados

# ══════════════════════════════════════════════════════════════════
# PIPELINE PRINCIPAL
# ══════════════════════════════════════════════════════════════════

def main():
    inicio = datetime.now()
    log("╔══════════════════════════════════════════════════════╗")
    log("║  ÁGORA iniciando — " + inicio.strftime("%d/%m/%Y %H:%M:%S") + "              ║")
    log("╚══════════════════════════════════════════════════════╝")

    # Conecta ao Sheets logo no início para falhar cedo se houver problema
    log("  Conectando ao Google Sheets...")
    planilha = conectar_sheets()
    log(f"  ✅ Conectado: {planilha.title}")

    # Módulo 1 — Coleta de posts
    posts = coletar_posts()
    if not posts:
        log("⚠️  Nenhum post coletado. Pipeline encerrado.")
        return

    # Módulo 2 — Coleta de comentários
    comentarios_por_post = coletar_comentarios(posts)

    # Módulo 3 — Memória contextual
    memoria = carregar_memoria(planilha)

    # Módulo 4 — Análise com o ÁGORA
    posts_analisados = analisar_com_agora(posts, comentarios_por_post, memoria)

    # Módulo 5 — Gravação no Sheets
    novos_radar, novos_coments = gravar_no_sheets(
        planilha, posts_analisados, comentarios_por_post
    )

    # Módulo 6 — Alertas WhatsApp
    alertas = disparar_alertas(posts_analisados)

    # Módulo 5b — Briefing diário (após alertas para incluir contagem)
    atualizar_briefing(planilha, posts_analisados, comentarios_por_post, alertas)

    # Resumo final
    fim      = datetime.now()
    duracao  = (fim - inicio).seconds
    log("")
    log("╔══════════════════════════════════════════════════════╗")
    log("║  ÁGORA concluído                                     ║")
    log(f"║  Posts coletados:    {len(posts):<4}                           ║")
    log(f"║  Posts analisados:   {len(posts_analisados):<4}                           ║")
    log(f"║  Comentários novos:  {novos_coments:<4}                           ║")
    log(f"║  Alertas enviados:   {alertas:<4}                           ║")
    log(f"║  Duração:            {duracao}s                            ║")
    log("╚══════════════════════════════════════════════════════╝")

if __name__ == "__main__":
    main()
