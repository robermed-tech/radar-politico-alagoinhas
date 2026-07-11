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
from dotenv import load_dotenv
load_dotenv()
# ── Taxonomia de subtemas (editavel) ──────────────────────────────
SUBTEMAS_POR_TEMA = {
    "saude": ["ubs_postos","hospital","upa","samu","medicamentos","filas_agendamento","atendimento"],
    "educacao": ["escolas","creches","merenda","transporte_escolar","professores","matriculas","infra_escolar"],
    "obras": ["pavimentacao","buracos","drenagem","calcadas","iluminacao_publica","pracas","obra_parada"],
    "seguranca": ["guarda_municipal","videomonitoramento","ronda","policiamento"],
    "transporte": ["onibus","mobilidade","transito","sinalizacao","tarifa_onibus"],
    "emprego": ["vagas","comercio_local","feiras","empreendedorismo","qualificacao"],
    "impostos": ["iptu","iss","taxas","refis"],
    "saneamento": ["abastecimento_agua","esgoto","tarifa_agua","coleta_lixo","limpeza_urbana"],
    "cultura_eventos": ["festas_festivais","shows","esporte_lazer","turismo","eventos"],
    "comunicacao": ["prestacao_contas","transparencia_portal","divulgacao_redes","ouvidoria","licitacoes"],
}

def _mapa_subtemas_txt():
    return "\n".join(f'  {t}: {"|".join(subs)}|outro' for t, subs in SUBTEMAS_POR_TEMA.items())

def normalizar_subtema(tema, subtema):
    tema = (tema or "").strip().lower()
    subtema = (subtema or "").strip().lower()
    return subtema if subtema in SUBTEMAS_POR_TEMA.get(tema, []) else "outro"

# ── Normalizacao de texto e localidade (bairros) ──────────────────
import unicodedata
import hashlib
from functools import lru_cache
from zoneinfo import ZoneInfo

TZ_BAHIA = ZoneInfo("America/Bahia")

def _norm(txt: str) -> str:
    """minusculas, sem acento, espacos colapsados."""
    txt = unicodedata.normalize("NFKD", txt or "")
    txt = "".join(ch for ch in txt if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", txt).strip().lower()

@lru_cache(maxsize=2048)
def _padrao(termo: str) -> re.Pattern:
    return re.compile(rf"(?<!\w){re.escape(termo)}(?!\w)")

def _tem_termo(texto: str, termo: str) -> bool:
    """True se `termo` aparece como palavra inteira em `texto`."""
    return bool(_padrao(_norm(termo)).search(_norm(texto)))

def hash_autor(tenant: str, username: str) -> str:
    """Hash irreversivel do autor do comentario (LGPD). Falha alto se o salt nao existir."""
    salt = os.environ["AUTOR_HASH_SALT"]
    base = f"{salt}|{tenant}|{(username or '').strip().lower()}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:32]

_BAIRRO_FALLBACK_MINIMO = {"nao_identificado": "nao_identificado"}

def carregar_bairros(tenant: str = None, abortar_em_falha: bool = True) -> dict:
    """
    Le public.bairros (ativo=true) do Supabase. Retorna {alias_normalizado: slug},
    incluindo `nome` e `slug` como aliases de si mesmos.

    Em falha durante execucao normal (abortar_em_falha=True, default): loga ERRO CRITICO
    e levanta RuntimeError — o pipeline nao deve gravar localidade='nao_identificado' em
    massa por uma falha de leitura (indistinguivel depois de "o cidadao nao citou bairro").
    Abortar e recuperavel; poluir a base nao e.

    So aceita o fallback minimo (so o sentinela nao_identificado) quando abortar_em_falha=False
    (uso: --teste-localidade), e mesmo assim loga um WARNING alto.
    """
    tenant = tenant or TENANT

    def _falhar(motivo):
        if abortar_em_falha:
            log(f"[bairros] ERRO CRITICO - leitura de public.bairros falhou ({motivo})")
            raise RuntimeError("bairros indisponivel - abortando para nao gravar localidade=nao_identificado em massa")
        log(f"[bairros] WARNING ALTO - FALLBACK HARDCODED - leitura do Supabase falhou ({motivo}) - modo teste")
        return dict(_BAIRRO_FALLBACK_MINIMO)

    if not SUPABASE_URL or not SUPABASE_KEY:
        return _falhar("SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes")

    try:
        rows = _supabase_get(
            "bairros",
            f"tenant=eq.{tenant}&ativo=eq.true&select=nome,slug,aliases",
        )
    except Exception as e:
        return _falhar(str(e))

    if not rows:
        return _falhar("nenhum bairro ativo retornado")

    mapa = {}
    for r in rows:
        slug = (r.get("slug") or "").strip().lower()
        if not slug:
            continue
        mapa[_norm(slug)] = slug
        nome = r.get("nome") or ""
        if nome:
            mapa[_norm(nome)] = slug
        for alias in (r.get("aliases") or []):
            if alias:
                mapa[_norm(alias)] = slug

    if not mapa:
        return _falhar("mapa de bairros vazio apos processamento")

    log(f"[bairros] Supabase: {len(rows)} bairros ativos, {len(mapa)} aliases carregados")
    return mapa

def normalizar_localidade(valor: str, mapa_bairros: dict) -> str:
    """
    Sempre devolve slug valido de public.bairros, ou 'nao_identificado'.
    Nunca texto livre. Nunca levanta excecao.

    Ordem de resolucao: match exato do slug -> match exato de alias normalizado ->
    _tem_termo (palavra inteira) -> 'nao_identificado'.
    """
    try:
        if not valor or not mapa_bairros:
            return "nao_identificado"
        v = _norm(valor)
        if v in mapa_bairros:
            return mapa_bairros[v]
        for alias_norm, slug in mapa_bairros.items():
            if alias_norm and _tem_termo(valor, alias_norm):
                return slug
    except Exception:
        pass
    return "nao_identificado"

# ==============================================================
# CONFIGURACAO
# ==============================================================

APIFY_TOKEN      = os.environ.get("APIFY_API_TOKEN", "")
ANTHROPIC_KEY    = os.environ["ANTHROPIC_API_KEY"]
SPREADSHEET_ID   = os.environ.get("SPREADSHEET_ID") or os.environ.get("GOOGLE_SHEET_ID", "")  # lazy: so exigido em conectar_sheets()
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
                               "administracao", "gestao de alagoinhas", "prefeito de alagoinhas"]
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
            params={"tenant_id": "eq.alagoinhas", "select": "keyword,active"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return None
        return [row["keyword"].lower() for row in r.json() if row.get("active", True)]
    except Exception:
        return None

def _carregar_tenant_settings():
    """Busca tenant_settings do Supabase. Retorna dict vazio se indisponível."""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        return {}
    try:
        r = requests.get(
            f"{url}/rest/v1/tenant_settings",
            params={"tenant_id": f"eq.{os.environ.get('RADAR_TENANT', 'alagoinhas')}",
                    "select": "score_weights,climate_thresholds,notification_config"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return {}
        return r.json()[0]
    except Exception:
        return {}

_TENANT_SETTINGS = _carregar_tenant_settings()
_ct = _TENANT_SETTINGS.get("climate_thresholds", {})
_nc = _TENANT_SETTINGS.get("notification_config", {})

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
OVERRIDE_ALERTA_ATIVO         = True
OVERRIDE_RESPONSABILIDADE_MIN = int(_ct.get("override_resp_min", 70))
OVERRIDE_SCORE_MIN            = 55
OVERRIDE_EXIGE_TRACAO         = True

# Limiares do boletim climático (passados como parâmetro ao gerar_boletim).
_LIMIAR_PREVISAO              = float(_ct.get("limiar_previsao", 8.0))
_LIMIAR_TEMPESTADE_COM_ALERTA = float(_ct.get("limiar_tempestade_com_alerta", 60.0))

# Limites de coleta
MAX_POSTS_POR_PERFIL    = 10
MAX_COMENTARIOS_POR_POST = 50
DIAS_RETROATIVOS        = 5
MAX_ALERTAS_POR_RUN     = 3   # cap de alertas WhatsApp por execução (anti-spam)

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
        import traceback
        log(f"  [etapa '{nome}' FALHOU] {e}")
        log(traceback.format_exc().strip())
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
        return False  # data inválida não passa o filtro (evita posts fantasma)

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
    if not SPREADSHEET_ID:
        raise ValueError("SPREADSHEET_ID nao configurado")
    creds_json = os.environ.get("GOOGLE_CREDENTIALS", "")
    if not creds_json:
        _cred_file = os.environ.get("GOOGLE_CREDENTIALS_FILE", "service_account.json")
        if os.path.exists(_cred_file):
            with open(_cred_file, "r", encoding="utf-8") as f:
                creds_json = f.read()
        else:
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
    params = {"token": APIFY_TOKEN, "memory": memory_mbytes}
    r = requests.post(url, params=params, json=input_data, timeout=30)
    if r.status_code not in (200, 201):
        if r.status_code == 403:
            try:
                err = r.json().get("error", {})
                if err.get("type") == "platform-feature-disabled":
                    log(f"    [APIFY — LIMITE MENSAL ATINGIDO] {err.get('message', 'Monthly usage hard limit exceeded')}")
                    log("    Acesse apify.com/billing para recarregar ou aguarde a virada do ciclo.")
                    return None
            except Exception:
                pass
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

def _enviar_whatsapp(mensagem: str, tentativas: int = 2) -> bool:
    """Envia mensagem WhatsApp via Evolution API com retry e verificação HTTPS.
    Retorna True se enviado com sucesso."""
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        return False
    if not EVOLUTION_URL.startswith("https://"):
        log("  WhatsApp: EVOLUTION_API_URL deve usar HTTPS — envio bloqueado")
        return False
    instance = os.environ.get("EVOLUTION_INSTANCE", "radar")
    url = f"{EVOLUTION_URL}/message/sendText/{instance}"
    headers = {"Content-Type": "application/json", "apikey": EVOLUTION_KEY}
    payload = {"number": WHATSAPP_NUMBER, "text": mensagem}
    for t in range(tentativas):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=15)
            if r.status_code in (200, 201):
                return True
            log(f"  WhatsApp: HTTP {r.status_code}{' — retentando' if t == 0 else ' — desistindo'}")
        except Exception as e:
            log(f"  WhatsApp: erro {e}{' — retentando' if t == 0 else ' — desistindo'}")
        if t == 0:
            time.sleep(3)
    return False


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
        # Persiste no Supabase para o admin dashboard
        try:
            _supabase_upsert("service_status", [{
                "tenant": TENANT, "servico": "apify",
                "uso_pct": round(pct, 1), "uso_usd": round(uso, 4),
                "teto_usd": round(teto, 4),
                "atualizado_em": datetime.utcnow().isoformat(),
            }], "tenant,servico")
        except Exception:
            pass
        if pct >= 80:
            restante = teto - uso
            msg = (
                f"⚠️ *RADAR — Créditos Apify em {pct:.0f}%*\n"
                f"Consumido: ${uso:.2f} de ${teto:.2f}\n"
                f"Restante: ${restante:.2f}\n"
                f"Acesse apify.com/billing para recarregar antes que a coleta pare."
            )
            if _enviar_whatsapp(msg):
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
            "comentarios_total": int(extrair(p, "commentsCount", "comments", "comment_count", padrao=0)),
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
    if not APIFY_TOKEN:
        log("  Apify: APIFY_API_TOKEN nao configurado — pulando")
    if APIFY_TOKEN:
        log("=== MODULO 1b - Coletando posts via Apify ===")
        try:
            input_data = {"username": perfis, "resultsLimit": MAX_POSTS_POR_PERFIL}
            # 1024 MB: o instagram-post-scraper estoura 256 MB (OOM, exit 137).
            # Runs a 256 MB usavam 244/256 e eram mortos; a 1024 MB rodam ate o fim.
            run_id = apify_iniciar_run(ACTOR_POSTS, input_data, memory_mbytes=1024)
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

def _parse_ts_bahia(ts_raw):
    """Converte timestamp ISO bruto (Apify) para (ts_iso, dia_bahia).
    Nunca inventa hora: retorna (None, None) se nao for parseavel — meia-noite
    UTC e 21h do dia anterior em Alagoinhas; sem o fuso, comentarios caem no
    bucket errado e enviesam daily_metrics."""
    if not ts_raw:
        return None, None
    try:
        s_iso = str(ts_raw).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        dt_bahia = dt.astimezone(TZ_BAHIA)
        return dt.isoformat(), dt_bahia.strftime("%Y-%m-%d")
    except Exception:
        return None, None

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

        ts_raw = str(extrair(c, "timestamp", "createdAt", "date", padrao=""))
        data_ts, data_dia = _parse_ts_bahia(ts_raw)

        comentario = {
            "id":       str(extrair(c, "id", "pk", padrao="")),
            "texto":    texto[:300],
            "username": username,
            "tipo":     tipo,
            "curtidas": int(extrair(c, "likesCount", "likes", "likeCount", padrao=0)),
            "data":     ts_raw[:10],
            "data_ts":  data_ts,
            "data_dia": data_dia,
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
    posts_com_coments = [p for p in posts if p["comentarios_total"] > 0]
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
            # 512 MB: mesmo motivo do post-scraper — 256 MB e insuficiente e causa OOM.
            run_id = apify_iniciar_run(ACTOR_COMMENTS, input_data, memory_mbytes=512)
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
        'Escolha o TEMA e depois um SUBTEMA valido para esse tema. Use "outro" se nenhum encaixar.\n'
        'Desambiguacao: drenagem/alagamento=obras; iluminacao publica=obras; '
        'coleta de lixo/limpeza/falta dagua/esgoto=saneamento; '
        'tarifa de onibus=transporte; tarifa/conta de agua=saneamento.\n'
        'SUBTEMAS validos por tema:\n'
        f'{_mapa_subtemas_txt()}\n\n'
        'Retorne JSON (pct_pos e pct_neg = % dos comentarios acima FAVORAVEIS / CONTRARIOS ao prefeito Gustavo):\n'
        '{"score_risco":<0-100>,"urgencia":"<alta|media|baixa>",'
        '"tema":"<saude|educacao|obras|seguranca|transporte|emprego|impostos|saneamento|cultura_eventos|comunicacao>",'
        '"subtema":"<slug conforme a lista acima>",'
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

  CASO FREQUENTE — POST DE ALIADO COM COMENTARIOS CRITICOS:
    A prefeitura/prefeito posta sobre programa, obra ou evento.
    Cidadaos comentam criticando a EXECUCAO ("nao funciona", "cadê o
    onibus", "parem de iludir o povo", "promessa sem cumprimento").
    ERRADO: sentimento_post = "positivo" (o POST e de aliado, mas os
    COMENTARIOS sao negativos — e a reacao que conta).
    CORRETO: sentimento_post = "negativo".
    A regra "ALIADO = POSITIVO" aplica-se ao sentimento de UM COMENTARIO
    que elogia o aliado. Se o comentario CRITICA o programa do aliado,
    esse comentario e NEGATIVO — e sentimento_post deve refletir isso.

VERIFICACAO FINAL OBRIGATORIA — execute antes de escrever sentimento_post:
  1. Qual e o sentimento_comentarios que voce ja calculou?
  2. Qual e o comentarios_pct_neg que voce ja calculou?
  Regras de derivacao:
    sentimento_comentarios = "negativo"            -> sentimento_post = "negativo"
    sentimento_comentarios = "misto" e pct_neg > pct_pos -> sentimento_post = "negativo"
    sentimento_comentarios = "misto" e pct_pos > pct_neg -> sentimento_post = "neutro"
    sentimento_comentarios = "positivo"            -> sentimento_post = "positivo"
    sentimento_comentarios = "neutro"              -> sentimento_post = "neutro"
  Esta derivacao e OBRIGATORIA. Supera qualquer outro raciocinio sobre
  quem fez o post (aliado ou nao). Nunca escreva sentimento_post = "positivo"
  quando sentimento_comentarios = "negativo" ou "misto" com pct_neg dominante.
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
Curtidas: {post["curtidas"]} | Comentarios totais: {post["comentarios_total"]}
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
  "tema": "<tema: saude|educacao|obras|seguranca|transporte|emprego|impostos|saneamento|cultura_eventos|comunicacao — saneamento=agua/esgoto/SAAE; cultura_eventos=festejos/shows/eventos; comunicacao=divulgacao/transparencia/mobilizacao-sem-tema-especifico>",
  "atribuicao": "<prefeito_pessoal|prefeitura_instituicao|secretaria|camara_vereadores|oposicao|governo_estadual|governo_federal|sociedade_civil|outros>",
  "tendencia": "<crescendo|estavel|caindo>",
  "urgencia": "<alta|media|baixa>",
  "sugestao_acao": "<acao concreta: monitorar|responder publicamente|acionar assessoria|conter crise|ampliar positivo>",
  "janela_acao": "<imediato|24h|esta semana>",
  "cluster_crise": "<vitima|acidental|intencional|nenhum — cluster SCCT (Situational Crisis Communication Theory, Coombs): vitima=gestao sofre ataque/boato; acidental=erro nao-intencional; intencional=descaso/negligencia percebida; nenhum=sem crise>",
  "responsabilidade_atribuida": <numero 0-100, atribuicao de responsabilidade SCCT: quanto o publico culpa o prefeito Gustavo por esta situacao>,
  "confianca": <numero 0-100, sua confianca nesta classificacao — baixe se texto for ambiguo, ironico ou faltar contexto>
}}"""
    return prompt

# ==============================================================
# MODULO 4b - HAIKU DEDICADO A COMENTARIOS (tema/subtema/localidade/pedido)
# ==============================================================
# Roda para TODO post que tem comentarios, independente do tier (rapido/profundo)
# do post — a demanda ordinaria do cidadao mora nos posts rotineiros, que ficam
# no tier rapido (so triagem) na maioria das vezes. O Sonnet NAO duplica esta
# analise; ele so faz a analise de crise no nivel do post.

LOTE_COMENTARIOS = 40  # teto por chamada — evita estourar max_tokens em post viral

PROMPT_COMENTARIOS = (
    "Classificador de comentarios de cidadaos em posts politicos. "
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
    "REGRA DO NEUTRO: comentario que nao menciona nem implica julgamento sobre a gestao = NEUTRO. "
    "IRONIA: emoji de risada (😂🤣😆) combinado com 'elogio' a gestao e quase sempre sarcasmo — "
    "classifique como NEGATIVO e baixe confianca_tema para no maximo 60.\n\n"
    "TEMA: e o tema DO COMENTARIO, nao do post — um cidadao pode reclamar da UPA debaixo "
    "de um post sobre pavimentacao.\n"
    "SUBTEMA: slug conforme a lista de subtemas por tema fornecida no prompt do usuario. "
    "Use 'outro' se nenhum encaixar.\n"
    "LOCALIDADE: bairro, praca, rua, escola ou equipamento publico citado NO COMENTARIO. "
    "Devolva EXATAMENTE como escrito pelo cidadao — nao normalize, nao corrija grafia. "
    "null se nenhum lugar for citado. NAO infira lugar a partir do tema nem do post.\n"
    "PEDIDO: demanda concreta, ate 8 palavras, no infinitivo (ex.: 'recapear a Avenida Juracy "
    "Magalhaes', 'aumentar o plantao medico na UPA'). null se for apenas opiniao, elogio ou "
    "ofensa, sem pedido concreto.\n"
    "CONFIANCA_TEMA: inteiro 0-100, confianca na classificacao de tema + sentimento deste "
    "comentario. Abaixo de 70 quando houver ironia, sarcasmo, giria ambigua, ou texto curto "
    "demais para decidir.\n\n"
    "Retorne APENAS JSON valido, sem markdown, sem texto extra."
)

def montar_prompt_comentarios(post, lote, offset):
    """Monta o prompt de um lote de ate LOTE_COMENTARIOS comentarios, numerados
    com indice GLOBAL (offset + posicao no lote) — nao reinicia a cada lote."""
    cat = (post.get("categoria") or "").lower()
    lado = ("OPOSITOR" if cat == "oposicao"
            else "ALIADO" if cat in ("prefeito", "prefeitura", "governo")
            else "IMPRENSA")
    nota_lado = (
        "ATENCAO: este e um perfil OPOSITOR. Comentarios apoiando/elogiando este perfil "
        "= NEGATIVO para o prefeito. So e POSITIVO se o comentario defende Gustavo ou "
        "ataca o opositor diretamente."
        if lado == "OPOSITOR" else
        "ATENCAO: este e um perfil ALIADO/GOVERNO. Comentarios elogiando a gestao = "
        "POSITIVO. Criticas = NEGATIVO."
        if lado == "ALIADO" else
        "Analise o conteudo de cada comentario para determinar o impacto na imagem do prefeito."
    )
    linhas = "".join(
        f'  [{offset + idx}] {c.get("curtidas", 0)}❤ @{c.get("username", "")}: "{c.get("texto", "")[:300]}"\n'
        for idx, c in enumerate(lote)
    )
    return (
        f'Perfil: @{post.get("autor", "")} ({post.get("categoria", "")}) [LADO: {lado}]\n'
        f'{nota_lado}\n\n'
        f'COMENTARIOS NUMERADOS (classifique CADA UM individualmente, pelo indice entre colchetes):\n'
        f'{linhas}\n'
        'SUBTEMAS validos por tema:\n'
        f'{_mapa_subtemas_txt()}\n\n'
        'Retorne APENAS este JSON:\n'
        '{"analise_comentarios": [\n'
        '  {"i": <indice EXATAMENTE como numerado acima>, '
        '"sentimento": "<positivo|negativo|neutro>", '
        '"tema": "<saude|educacao|obras|seguranca|transporte|emprego|impostos|saneamento|cultura_eventos|comunicacao>", '
        '"subtema": "<slug conforme a lista acima>", '
        '"localidade": "<bairro/praca/rua/escola citado, como escrito, ou null>", '
        '"pedido": "<demanda concreta ate 8 palavras no infinitivo, ou null>", '
        '"confianca_tema": <0-100>}, ...\n'
        ']}\n'
        f'O array deve ter exatamente {len(lote)} itens (1 por comentario numerado acima).'
    )

def analisar_comentarios_haiku(post, cidadaos_ordenados, cliente):
    """Classifica TODOS os comentarios de cidadaos de um post via Haiku dedicado,
    em lotes de LOTE_COMENTARIOS, com indice GLOBAL. Roda independente do tier
    (rapido/profundo) do post — o Sonnet nao analisa comentario individualmente.

    Retorna {indice_global: {"i", "sentimento", "tema", "subtema", "localidade",
    "pedido", "confianca_tema"}}. Indices ausentes na resposta ficam de fora do
    dict — quem chama preenche o default (nunca alinha por posicao)."""
    n = len(cidadaos_ordenados)
    if n == 0:
        return {}

    resultado_por_i = {}
    for offset in range(0, n, LOTE_COMENTARIOS):
        lote = cidadaos_ordenados[offset: offset + LOTE_COMENTARIOS]
        try:
            resp = cliente.messages.create(
                model=MODELO_ANALISTA,
                max_tokens=200 + 120 * len(lote),
                system=PROMPT_COMENTARIOS,
                messages=[{"role": "user", "content": montar_prompt_comentarios(post, lote, offset)}],
            )
            data = _parse_json_resposta(resp.content[0].text)
            analises = data.get("analise_comentarios")
            if analises is None:
                # Compat: formato antigo (array de strings de sentimento apenas)
                antigos = data.get("sentimentos_comentarios") or []
                log(f"    [comentarios] WARNING: resposta sem 'analise_comentarios' — "
                    f"caindo no formato antigo 'sentimentos_comentarios' ({len(antigos)} itens)")
                analises = [
                    {"i": offset + idx, "sentimento": s, "tema": "outro", "subtema": "outro",
                     "localidade": None, "pedido": None, "confianca_tema": 0}
                    for idx, s in enumerate(antigos)
                ]
            if len(analises) != len(lote):
                log(f"    [comentarios] WARNING: {len(lote)} comentarios, "
                    f"{len(analises)} analises recebidas (lote offset={offset})")
            for item in analises:
                try:
                    idx_i = int(item.get("i"))
                except (TypeError, ValueError):
                    continue
                resultado_por_i[idx_i] = item
        except Exception as e:
            log(f"    [comentarios] Haiku falhou no lote offset={offset} ({e}) — defaults")
        time.sleep(0.5)
    return resultado_por_i


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

def analisar_com_agora(posts, comentarios_por_post, memoria, mapa_bairros):
    log(f"=== MODULO 4 - Analisando com o AGORA (triagem 2 niveis | limiar={LIMIAR_TRIAGEM}) ===")
    log(f"    Triagem: {MODELO_ANALISTA} | Profundo: {MODELO_PROFUNDO} | Comentarios: {MODELO_ANALISTA}")
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
        # Posts de oposicao sempre vao para o Sonnet: o Haiku confunde
        # "elogio ao opositor" com pct_pos alto, invertendo a polaridade.
        eh_oposicao = (post.get("categoria") or "").lower() == "oposicao"
        analise_profunda = score_tri >= LIMIAR_TRIAGEM or triagem.get("urgencia") == "alta" or eh_oposicao

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

        # Safety net: corrige sentimento_post com base nos percentuais e no
        # sentimento_comentarios. Captura casos onde o modelo classifica como
        # "negativo" mas pct_neg < 50%, ou "misto" com negativo dominante.
        pct_neg = float(analise.get("comentarios_pct_neg", 0) or 0)
        pct_pos = float(analise.get("comentarios_pct_pos", 0) or 0)
        sent_coments = (analise.get("sentimento_comentarios") or "").lower()
        if pct_neg > 50:
            analise["sentimento_post"] = "negativo"
        elif sent_coments == "negativo" and analise_profunda:
            # Sonnet classificou explicitamente como negativo — prevalece mesmo com pct_neg < 50
            analise["sentimento_post"] = "negativo"
        elif sent_coments == "misto" and pct_neg > pct_pos:
            # Misto mas negativo-dominante: critica supera elogio em volume
            analise["sentimento_post"] = "negativo"
        elif pct_pos > 60 and not eh_oposicao:
            analise["sentimento_post"] = "positivo"
        elif pct_pos > 60 and eh_oposicao:
            analise["sentimento_post"] = "negativo"
        elif analise.get("sentimento_post") not in ("positivo", "negativo", "neutro"):
            analise["sentimento_post"] = "neutro"
        # Normaliza tema: valores fora do conjunto permitido → "comunicacao"
        _tema_validos = {"saude", "educacao", "obras", "seguranca", "transporte",
                         "emprego", "impostos", "saneamento", "cultura_eventos", "comunicacao"}
        if (analise.get("tema") or "").lower().strip() not in _tema_validos:
            analise["tema"] = "comunicacao"

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
        print("[DEBUG] Haiku:", repr(analise.get("tema")), "|", repr(analise.get("subtema")))
        post_enriquecido["subtema"] = normalizar_subtema(
            analise.get("tema"), analise.get("subtema")
        )
        resultado.append(post_enriquecido)

        # Classificacao individual dos comentarios de cidadaos (Haiku dedicado,
        # roda para TODO post independente do tier). Indice ausente na resposta
        # -> defaults explicitos; NUNCA alinha por posicao (enumerate paralelo).
        cidadaos_lista = sorted(
            [c for c in comentarios if c["tipo"] == "cidadao"],
            key=lambda x: x["curtidas"], reverse=True
        )
        analise_por_i = analisar_comentarios_haiku(post, cidadaos_lista, cliente)
        classificados = 0
        for idx, c in enumerate(cidadaos_lista):
            item = analise_por_i.get(idx)
            if item:
                sent = item.get("sentimento")
                c["sentimento"] = sent if sent in ("positivo", "negativo", "neutro") else "neutro"
                tema_c = item.get("tema") or "outro"
                c["tema"] = tema_c
                c["subtema"] = normalizar_subtema(tema_c, item.get("subtema"))
                c["localidade"] = normalizar_localidade(item.get("localidade"), mapa_bairros)
                c["pedido"] = item.get("pedido") or None
                try:
                    c["confianca_tema"] = int(item.get("confianca_tema") or 0)
                except (TypeError, ValueError):
                    c["confianca_tema"] = 0
                classificados += 1
            else:
                c["sentimento"] = "neutro"
                c["tema"] = "outro"
                c["subtema"] = "outro"
                c["localidade"] = "nao_identificado"
                c["pedido"] = None
                c["confianca_tema"] = 0

        # Perfis politicos (nao classificados pelo Haiku de comentarios): herdam
        # o sentimento agregado do post.
        fallback = analise.get("sentimento_comentarios", "neutro")
        if fallback == "misto":
            fallback = "neutro"
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
                      or int(post.get("comentarios_total", 0) or 0) > 100)
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
            p.get("categoria", ""), p.get("curtidas", 0), p.get("comentarios_total", 0),
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
    """Upsert via PostgREST. Retorna qtd gravada ou 0 em falha/desativado.
    Faz 1 retry após 5s em caso de falha de rede ou status inesperado."""
    if not SUPABASE_URL or not SUPABASE_KEY or not linhas:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?on_conflict={on_conflict}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for tentativa in range(2):
        try:
            r = requests.post(url, headers=headers, data=json.dumps(linhas), timeout=30)
            if r.status_code in (200, 201, 204):
                return len(linhas)
            log(f"    Supabase {tabela}: HTTP {r.status_code} {r.text[:160]}"
                + (" — retentando" if tentativa == 0 else " — desistindo"))
        except Exception as e:
            log(f"    Supabase {tabela}: erro {e}"
                + (" — retentando" if tentativa == 0 else " — desistindo"))
        if tentativa == 0:
            time.sleep(5)
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
            "comentarios_total": int(p.get("comentarios_total", 0) or 0),
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
            "subtema": p.get("subtema", "outro"),
            "tendencia": p.get("tendencia", "estavel"),
            "urgencia": p.get("urgencia", "baixa"),
            "sugestao_acao": p.get("sugestao_acao", ""),
            "janela_acao": p.get("janela_acao", ""),
            "caption": (p.get("caption", "") or "")[:500],
            # Camada SCCT/Coombs (requer colunas de supabase/scct_posts_e_irt.sql)
            "cluster_crise": p.get("cluster_crise", "nenhum") or "nenhum",
            "responsabilidade_atribuida": int(p.get("responsabilidade_atribuida", 0) or 0),
            "confianca": int(p.get("confianca", 0) or 0),
            "abordagem_recomendada": p.get("abordagem_recomendada", ""),
            "por_que_funciona": p.get("por_que_funciona", ""),
            "motivo_alerta": p.get("motivo_alerta", ""),
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
                "tema":               c.get("tema", "outro"),
                "subtema":            c.get("subtema", "outro"),
                "localidade":         c.get("localidade", "nao_identificado"),
                "pedido":             c.get("pedido") or None,
                "confianca_tema":     int(c["confianca_tema"]) if c.get("confianca_tema") is not None else None,
                "autor_hash":         hash_autor(TENANT, c.get("username", "")),
                "data_comentario_ts":  c.get("data_ts") or None,
                "data_comentario_dia": c.get("data_dia"),
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
        n = int(p.get("comentarios_total", 0) or 0)
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
    nComents = sum(int(p.get("comentarios_total", 0) or 0) for p in posts)
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
            "volume_coments": sum(int(p.get("comentarios_total", 0) or 0) for p in ps),
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
    """Lê config de alertas do Supabase (ou usa defaults de env) e dispara WhatsApp.
    Retorna a lista de temas que dispararam alerta temático (p/ o laço IRT)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        return []

    # Throttle: no máximo 1 alerta de limiar a cada 6h para não repetir o mesmo alerta 3x/dia
    try:
        limite_6h = (datetime.utcnow() - timedelta(hours=6)).isoformat()
        recentes = _supabase_get(
            "alerta_historico",
            f"tenant_id=eq.{TENANT}&tipo=eq.auto&canal=eq.whatsapp"
            f"&criado_em=gte.{limite_6h}&select=id&limit=1"
        )
        if recentes:
            log("  verificar_alertas: alerta ja enviado nas ultimas 6h — pulando")
            return []
    except Exception:
        pass  # se falhar a checagem, deixa enviar

    # Calcula índices do ciclo atual
    iad = calc_iad(posts_analisados)
    total = len(posts_analisados)
    if total == 0:
        return []
    neg_pct = round(sum(1 for p in posts_analisados if _sent(p) == "negativo") / total * 100)

    # Prioridade: tenant_settings.notification_config > alerta_config > env vars
    limiar_iad  = int(_nc.get("iad_limiar",  os.environ.get("ALERTA_IAD_LIMIAR",  40)))
    limiar_neg  = int(_nc.get("neg_limiar",  os.environ.get("ALERTA_NEG_LIMIAR",  60)))
    limiar_tema = int(_nc.get("tema_limiar", os.environ.get("ALERTA_TEMA_LIMIAR", 50)))
    ativo_iad   = bool(_nc.get("iad_ativo",  True))
    ativo_neg   = bool(_nc.get("neg_ativo",  True))
    ativo_tema  = bool(_nc.get("tema_ativo", False))

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

    if ativo_iad and iad < limiar_iad:
        alertas.append(f"⚠ IAD em {iad}% — abaixo do limiar de {limiar_iad}%. Monitoramento recomendado.")

    if ativo_neg and neg_pct > limiar_neg:
        alertas.append(f"🔴 {neg_pct}% dos posts são negativos — acima do limiar de {limiar_neg}%.")

    # Tema com maior negatividade
    tema_map = {}
    for p in posts_analisados:
        t = p.get("tema", "") or ""
        if not t or t == "—": continue
        tema_map.setdefault(t, {"neg": 0, "tot": 0, "coments": 0})
        tema_map[t]["tot"] += 1
        tema_map[t]["coments"] += int(p.get("comentarios_total", 0) or 0)
        if _sent(p) == "negativo": tema_map[t]["neg"] += 1
    temas_alertados = []
    if ativo_tema:
        for tema, v in tema_map.items():
            if v["tot"] < 3: continue
            pneg = round(v["neg"] / v["tot"] * 100)
            if pneg >= limiar_tema:
                alertas.append(
                    f"⚡ Tema '{tema}' com {pneg}% negativo em {v['tot']} posts "
                    f"({v['coments']} comentários) — acima do limiar de {limiar_tema}%. "
                    f"Preocupação coletiva, não menção isolada."
                )
                temas_alertados.append(tema)
                break

    if not alertas:
        return temas_alertados

    log(f"=== ALERTAS: {len(alertas)} disparo(s) ===")
    data_hoje = datetime.now().strftime("%d/%m/%Y %H:%M")
    mensagem  = f"*🚨 Radar Político — Alerta Automático ({data_hoje})*\n\n"
    mensagem += "\n".join(alertas)
    mensagem += f"\n\n_Alagoinhas/BA · IAD atual: {iad}%_"

    if _enviar_whatsapp(mensagem):
        log(f"  Alerta WhatsApp enviado: {len(alertas)} gatilho(s)")
        for msg in alertas:
            _supabase_upsert("alerta_historico", [{
                "tenant_id": TENANT, "tipo": "auto", "valor": int(round(iad)),
                "mensagem": msg, "canal": "whatsapp",
                "criado_em": datetime.now().isoformat(),
            }], "id")
    else:
        log("  Alerta WhatsApp: falhou (ver log acima)")
    return temas_alertados


# ==============================================================
# MODULO IRT - ACOMPANHAMENTO DE RECUPERACAO POS-ALERTA
# ==============================================================
# Image Restoration Theory (Benoit): depois que um tema dispara alerta,
# registra o pico e acompanha nos runs seguintes se o volume/negatividade
# esta caindo (resposta efetiva) ou persistindo (resposta nao efetiva).
# Tabela: temas_monitorados (supabase/scct_posts_e_irt.sql).

def atualizar_temas_monitorados(posts_analisados, temas_alertados):
    """Registra picos de temas alertados e atualiza a tendencia de recuperacao."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return

    hoje = datetime.now().strftime("%Y-%m-%d")

    # Estatisticas atuais por tema (mesma janela que o run enxerga: DIAS_RETROATIVOS)
    stats = {}
    for p in posts_analisados:
        t = (p.get("tema", "") or "").strip().lower()
        if not t or t == "—":
            continue
        s = stats.setdefault(t, {"tot": 0, "neg": 0})
        s["tot"] += 1
        if _sent(p) == "negativo":
            s["neg"] += 1

    # Temas que dispararam alerta neste run: alerta tematico + posts com motivo_alerta
    temas_novos = {t.strip().lower() for t in temas_alertados if t}
    for p in posts_analisados:
        if p.get("motivo_alerta"):
            t = (p.get("tema", "") or "").strip().lower()
            if t and t != "—":
                temas_novos.add(t)

    existentes = {
        r["tema"]: r
        for r in _supabase_get("temas_monitorados", f"tenant=eq.{TENANT}&select=*")
        if r.get("tema")
    }

    rows = []

    # 1. Registra picos novos (ou re-arma tema ja recuperado que voltou a alertar)
    for tema in temas_novos:
        s = stats.get(tema, {"tot": 0, "neg": 0})
        pneg = round(s["neg"] / s["tot"] * 100) if s["tot"] else 0
        atual = existentes.get(tema)
        if atual and atual.get("status") == "monitorando":
            # pico ainda subindo: atualiza o pico se o volume atual superou
            if s["tot"] > int(atual.get("volume_pico", 0) or 0):
                atual["volume_pico"] = s["tot"]
                atual["pneg_pico"] = pneg
                atual["pico_em"] = hoje
            continue  # atualizacao de tendencia acontece no passo 2
        rows.append({
            "tenant": TENANT, "tema": tema, "pico_em": hoje,
            "origem": "alerta automatico",
            "volume_pico": s["tot"], "pneg_pico": pneg,
            "volume_atual": s["tot"], "pneg_atual": pneg,
            "tendencia": "estavel", "status": "monitorando",
            "atualizado_em": datetime.now().isoformat(),
        })

    # 2. Atualiza tendencia/status dos temas ja em monitoramento
    for tema, r in existentes.items():
        if r.get("status") not in ("monitorando", "persistente"):
            continue
        s = stats.get(tema, {"tot": 0, "neg": 0})
        pneg = round(s["neg"] / s["tot"] * 100) if s["tot"] else 0
        vol_pico = int(r.get("volume_pico", 0) or 0) or 1
        try:
            dias = (datetime.now() - datetime.strptime(str(r.get("pico_em"))[:10], "%Y-%m-%d")).days
        except Exception:
            dias = 0
        if s["tot"] > vol_pico:
            tendencia = "em_alta"
        elif s["tot"] <= vol_pico * 0.5:
            tendencia = "em_queda"
        else:
            tendencia = "estavel"
        status = r.get("status", "monitorando")
        if dias >= 3 and tendencia == "em_queda":
            status = "recuperado"
        elif dias >= 7 and tendencia != "em_queda":
            status = "persistente"  # resposta nao foi efetiva
        rows.append({
            "tenant": TENANT, "tema": tema,
            "pico_em": str(r.get("pico_em"))[:10],
            "origem": r.get("origem", ""),
            "volume_pico": int(r.get("volume_pico", 0) or 0),
            "pneg_pico": float(r.get("pneg_pico", 0) or 0),
            "volume_atual": s["tot"], "pneg_atual": pneg,
            "tendencia": tendencia, "status": status,
            "atualizado_em": datetime.now().isoformat(),
        })

    if not rows:
        return
    n = _supabase_upsert("temas_monitorados", rows, "tenant,tema")
    log(f"  IRT: {n} tema(s) monitorado(s) atualizados "
        f"({len(temas_novos)} pico(s) neste run)")


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

def _alinhamento(pct_pos, pct_neg, categoria=""):
    cat = (categoria or "").lower()
    if any(k in cat for k in ("prefeitura", "prefeito", "governo", "gestao", "aliado")):
        return "aliado"
    if any(k in cat for k in ("oposi",)):
        return "opositor"
    # Para imprensa/neutros: inferir pelos sentimentos dos posts
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
        d["coments"]  += int(p.get("comentarios_total", 0) or 0)
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
            "alinhamento": _alinhamento(pct_pos, pct_neg, d["categoria"]),
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
        c["vol_coments"]  += int(p.get("comentarios_total", 0) or 0)

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
        d["coments"]  += int(p.get("comentarios_total", 0) or 0)
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
    score_img   = post.get("score_imagem", 50)
    score_risco = post.get("score_risco", 0)
    emoji = "🔴" if score_img <= 20 else "🟠"
    queixa   = (post.get("queixa_dominante", "") or "—").strip()
    destaque = (post.get("comentarios_destaque", post.get("comentario_destaque", "")) or "").strip()
    autor_d  = (post.get("comentarios_destaque_autor", "") or "").strip()
    likes_d  = int(post.get("comentarios_destaque_curtidas", 0) or 0)
    resumo   = (post.get("resumo", "") or "").strip()
    motivo   = (post.get("motivo_alerta", "") or f"Score risco {score_risco}").strip()

    linhas = [
        f"{emoji} *ALERTA — Radar Político Alagoinhas*",
        "",
        f"*@{post.get('autor','')}* ({post.get('categoria','')})  ·  {post.get('data_post','')}",
        f"Imagem {score_img}/100  ·  Risco {score_risco}/100",
        post.get("url", ""),
        "",
        "*🔍 Queixa a observar:*",
        f"_{queixa}_",
    ]

    if destaque:
        ref = f" — @{autor_d} ({likes_d}❤)" if autor_d else ""
        linhas += [
            "",
            "*💬 Comentário em destaque:*",
            f'>>> "{destaque}"{ref}',
        ]

    if resumo:
        linhas += ["", f"*📊 Contexto:* _{resumo}_"]

    linhas += [
        "",
        f"*Ação:* {post.get('sugestao_acao', '')}  ·  janela: {post.get('janela_acao', '')}",
        f"*SCCT:* {post.get('abordagem_recomendada', '') or '—'}",
        "",
        f"_{motivo}_",
        "_Mensagem automática do AGORA_",
    ]
    return "\n".join(linhas)

def disparar_alertas(posts_analisados):
    """Agrupa todos os posts que disparam alerta em UMA mensagem (anti-spam).
    Envia no máximo MAX_ALERTAS_POR_RUN posts detalhados; os excedentes são listados
    com handle + score no rodapé da mensagem."""
    log("=== MODULO 6 - Verificando alertas ===")
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        log("  Evolution API nao configurada - alertas desativados")
        return 0

    # Coleta posts que disparam
    disparados = []
    for post in posts_analisados:
        score_img   = post.get("score_imagem", 50)
        score_risco = post.get("score_risco", 0)
        if not (score_img <= SCORE_IMAGEM_ALERTA or deve_disparar_alerta(score_risco, post)):
            continue
        if not post.get("motivo_alerta") and deve_disparar_alerta(score_risco, post):
            post["motivo_alerta"] = motivo_do_alerta(score_risco, post)
        disparados.append(post)

    if not disparados:
        log("  Nenhum post atingiu o limiar de alerta")
        return 0

    # Ordena por score_risco desc, aplica cap
    disparados.sort(key=lambda p: p.get("score_risco", 0), reverse=True)
    principais = disparados[:MAX_ALERTAS_POR_RUN]
    excedentes = disparados[MAX_ALERTAS_POR_RUN:]

    log(f"  {len(disparados)} post(s) disparam alerta — enviando 1 mensagem consolidada")

    # Monta mensagem consolidada
    partes = []
    for i, post in enumerate(principais, 1):
        score_img   = post.get("score_imagem", 50)
        score_risco = post.get("score_risco", 0)
        emoji = "🔴" if score_img <= 20 or score_risco >= 85 else "🟠"
        bloco = (
            f"{emoji} *#{i} @{post.get('autor','')} ({post.get('categoria','')})*\n"
            f"Risco: {score_risco}/100 | Imagem: {score_img}/100\n"
            f"Queixa: {post.get('queixa_dominante','—')}\n"
            f"Ação: {post.get('sugestao_acao','—')}\n"
            f"Janela: {post.get('janela_acao','—')}\n"
            f"{post.get('url','')}"
        )
        partes.append(bloco)

    data_hora = datetime.now().strftime("%d/%m/%Y %H:%M")
    mensagem = f"🚨 *ALERTA AGORA — Radar Político ({data_hora})*\n{len(disparados)} post(s) em atenção\n\n"
    mensagem += "\n\n──────────\n\n".join(partes)

    if excedentes:
        mensagem += "\n\n*+ outros posts em alerta:*\n"
        for p in excedentes:
            mensagem += f"• @{p.get('autor','')} — risco {p.get('score_risco',0)}/100\n"

    mensagem += "\n\n_Mensagem automática do AGORA_"

    ok = _enviar_whatsapp(mensagem)
    if ok:
        log(f"  Alerta consolidado enviado ({len(disparados)} post(s))")
        return len(disparados)
    else:
        log("  Falha ao enviar alerta consolidado")
        return 0

# ==============================================================
# MODULO 6b - UPDATE DE COMENTARIOS NOVOS
# ==============================================================

def enviar_update_coments(post, motivo_update):
    """Alerta de mudança relevante em post de alto risco já analisado."""
    log(f"  Update: @{post.get('autor','')} — {motivo_update}")
    queixa   = (post.get("queixa_dominante", "") or "—").strip()
    destaque = (post.get("comentarios_destaque", "") or "").strip()
    autor_d  = (post.get("comentarios_destaque_autor", "") or "").strip()
    likes_d  = int(post.get("comentarios_destaque_curtidas", 0) or 0)

    linhas = [
        "🔔 *ATUALIZAÇÃO — Radar Político Alagoinhas*",
        "",
        f"*@{post.get('autor','')}* ({post.get('categoria','')})  ·  {post.get('data_post','')}",
        f"Risco {post.get('score_risco', 0)}/100  ·  {motivo_update}",
        post.get("url", ""),
        "",
        "*🔍 Queixa a observar:*",
        f"_{queixa}_",
    ]

    if destaque:
        ref = f" — @{autor_d} ({likes_d}❤)" if autor_d else ""
        linhas += [
            "",
            "*💬 Comentário em destaque:*",
            f'>>> "{destaque}"{ref}',
        ]

    linhas += [
        "",
        f"*Ação:* {post.get('sugestao_acao', '')}",
        "_Mensagem automática do AGORA_",
    ]
    msg = "\n".join(linhas)
    if _enviar_whatsapp(msg):
        log("    Update enviado")


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

    # Contexto histórico: compara com ontem via daily_metrics
    delta_iad = delta_risco = None
    try:
        ontem = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
        hist = _supabase_get("daily_metrics",
            f"tenant=eq.{TENANT}&dia=eq.{ontem}&select=iad,risco&limit=1")
        if hist:
            delta_iad   = round(iad   - float(hist[0].get("iad",   iad)),   1)
            delta_risco = round(risco - float(hist[0].get("risco", risco)), 1)
    except Exception:
        pass

    def _seta(v):
        if v is None: return ""
        seta = "▲" if v > 0 else "▼"
        return f" ({seta}{abs(v):+.0f} vs ontem)"

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
        f"• Aprovação Digital (IAD): {iad:.0f}/100{_seta(delta_iad)}",
        f"• Risco Político: {risco:.0f}/100 {emoji_nivel} {nivel.upper()}{_seta(delta_risco)}",
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

    if _enviar_whatsapp(mensagem):
        log("  Briefing matinal enviado via WhatsApp")
    else:
        log("  Briefing matinal: falhou no envio")


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
        por_cat[cat] = por_cat.get(cat, 0) + int(p.get("comentarios_total", 0) or 0)
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
        limiar_previsao=_LIMIAR_PREVISAO,
        limiar_tempestade_com_alerta=_LIMIAR_TEMPESTADE_COM_ALERTA,
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

    # Carrega estado anterior dos posts para detectar mudanças reais (dedup de alertas).
    # Supabase é a fonte primária; Sheets é fallback caso Supabase esteja indisponível.
    # Sentinel None = carregamento falhou nas duas fontes; bloqueia alertas para evitar spam
    # (se existentes_radar virasse {} por falha, todo post pareceria "novo" e todo alerta disparava).
    # Estrutura: {url: {"comentarios_total": int, "score_risco": int, "queixa_dominante": str}}
    def _snap(r):
        return {
            "comentarios_total": int(r.get("comentarios_total", 0) or 0),
            "score_risco":       int(r.get("score_risco", 0) or 0),
            "queixa_dominante":  (r.get("queixa_dominante", "") or "").strip(),
        }

    existentes_radar = None
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            rows = _supabase_get(
                "posts",
                f"tenant=eq.{TENANT}&select=url,comentarios_total,score_risco,queixa_dominante"
            )
            existentes_radar = {r["url"]: _snap(r) for r in rows if r.get("url")}
            log(f"  {len(existentes_radar)} posts carregados do Supabase")
        except Exception as e:
            log(f"  Supabase existentes: falha ({e}) — tentando Sheets como fallback")
    if existentes_radar is None:
        try:
            aba_r = garantir_aba(planilha, "Radar", CABECALHO_RADAR)
            existentes_radar = {
                r["url"]: _snap(r)
                for r in aba_r.get_all_records()
                if r.get("url")
            }
            log(f"  {len(existentes_radar)} posts carregados do Sheets (fallback)")
        except Exception as e:
            log(f"  Sheets tambem falhou ({e}) — alertas suspensos neste run para evitar spam")

    posts = coletar_posts()
    if not posts:
        log("  Nenhum post coletado. Pipeline encerrado.")
        _safe("creditos_apify", verificar_creditos_apify)  # registra status mesmo sem posts (ex: limite mensal atingido)
        return

    comentarios_por_post = coletar_comentarios(posts)
    memoria = carregar_memoria(planilha)
    # Falha em carregar bairros aborta o run (RuntimeError) — nao gravamos
    # localidade='nao_identificado' em massa por indisponibilidade do Supabase.
    mapa_bairros = carregar_bairros(abortar_em_falha=True)
    posts_analisados = analisar_com_agora(posts, comentarios_por_post, memoria, mapa_bairros)
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
    # Briefing matinal: run das 08h BRT (11h UTC) — aceita 11 ou 12 UTC p/ tolerar
    # atraso do cron do GitHub Actions. Forcar com BRIEFING_MATINAL=true.
    hora_utc = datetime.utcnow().hour
    if briefing_ia and (hora_utc in (11, 12) or os.environ.get("BRIEFING_MATINAL", "").lower() == "true"):
        _safe("briefing_matinal", enviar_briefing_matinal, posts_analisados, briefing_ia)
    _safe("cacador_crises", rodar_cacador_crises, posts_analisados, comentarios_por_post)  # agente caçador de crises (Fase B)
    _safe("influencers", gravar_influencers, posts_analisados, comentarios_por_post)       # ranking de influenciadores
    _safe("narratives", gravar_narratives, posts_analisados, comentarios_por_post)         # narrativas (tema + sentimento)
    _safe("daily_themes", gravar_daily_themes, posts_analisados)                           # tendencias por tema (Fase 3e)
    temas_alertados = _safe("alertas_limiar", verificar_alertas, posts_analisados) or []   # alertas por limiar (Sprint 2)
    # Posts novos: nunca vistos antes → alerta completo se score disparar.
    # Posts existentes: só re-alerta se houver mudança real (comentários, risco ou queixa).
    # Se existentes_radar=None (falha de carregamento nas duas fontes), alertas sao
    # suspensos neste run para evitar spam (toda a base pareceria "posts novos").
    if existentes_radar is None:
        log("  Alertas WhatsApp suspensos: nao foi possivel carregar historico de posts")
        alertas = 0
    else:
        posts_novos = [p for p in posts_analisados if p.get("url") not in existentes_radar]

        def _motivo_update(url, post_novo):
            """Retorna string descritiva da mudança, ou '' se não houve mudança relevante."""
            ant = existentes_radar[url]
            delta_c = post_novo.get("comentarios_total", 0) - ant["comentarios_total"]
            delta_r = post_novo.get("score_risco", 0) - ant["score_risco"]
            queixa_nova = (post_novo.get("queixa_dominante", "") or "").strip()
            partes = []
            if delta_c >= 5:
                partes.append(f"+{delta_c} novos comentários")
            if delta_r >= 10:
                partes.append(f"risco subiu {delta_r} pts")
            if queixa_nova and queixa_nova != ant["queixa_dominante"]:
                partes.append(f"nova queixa: {queixa_nova}")
            return ", ".join(partes)

        posts_com_update = []
        motivos_update = {}
        for p in posts_analisados:
            url = p.get("url", "")
            if url not in existentes_radar:
                continue
            if not deve_disparar_alerta(int(p.get("score_risco", 0) or 0), p):
                continue
            motivo = _motivo_update(url, p)
            if motivo:
                posts_com_update.append(p)
                motivos_update[url] = motivo

        alertas = disparar_alertas(posts_novos)
        for p in posts_com_update:
            enviar_update_coments(p, motivos_update[p["url"]])
    # Laço IRT: registra picos dos temas alertados e mede recuperação nos runs seguintes
    _safe("irt_temas", atualizar_temas_monitorados, posts_analisados, temas_alertados)
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

    # Grava saude do pipeline no Supabase para o dashboard monitorar
    _safe("pipeline_health", _supabase_upsert, "pipeline_health", [{
        "tenant":          TENANT,
        "executado_em":    fim.isoformat(),
        "duracao_s":       duracao,
        "posts_coletados": len(posts),
        "posts_analisados": len(posts_analisados),
        "alertas_enviados": alertas if isinstance(alertas, int) else 0,
        "status":          "ok",
    }], "tenant")

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
    """Busca os últimos 5 posts do Supabase e testa o filtro de relevância."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[teste-filtro] SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.")
        return

    # Keywords em uso
    if _keywords_banco:
        print(f"[keywords] Supabase: {len(_keywords_banco)} keywords → {_keywords_banco}")
    else:
        print(f"[keywords] Fallback — governo:{KEYWORDS_GOVERNO} | oposicao:{KEYWORDS_OPOSICAO} | imprensa:{KEYWORDS_IMPRENSA}")

    print("\n[teste-filtro] Buscando últimos 5 posts do Supabase…")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/posts",
        params={"tenant": "eq.alagoinhas", "select": "autor,caption,categoria",
                "order": "data_post.desc", "limit": 5},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=10,
    )
    if r.status_code != 200:
        print(f"[teste-filtro] Erro ao buscar posts: {r.status_code} {r.text[:200]}")
        return

    posts = r.json()
    if not posts:
        print("[teste-filtro] Nenhum post encontrado no Supabase.")
        return

    print(f"\n[teste-filtro] {len(posts)} posts — testando filtro de relevância:\n")
    for i, p in enumerate(posts, 1):
        handle  = (p.get("autor") or "(desconhecido)").lower()
        caption = p.get("caption") or ""
        info    = PERFIS.get(handle, {"categoria": "Desconhecido", "filtro": "governo"})
        filtro  = info["filtro"]

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


def main_retroanalise():
    """Varredura completa: re-analisa todos os posts existentes no Supabase.

    Posts de oposicao: analise profunda com Sonnet + comentarios reais.
      (O Haiku interpretava pct_pos como "elogio ao opositor", nao ao prefeito.)
    Demais posts: apenas re-aplica o safety net local (sem chamada a API).
    Ao final recalcula daily_metrics com os dados corrigidos.
    """
    log("+====================================================+")
    log("|  RETROANALISE — varredura de todos os posts         |")
    log("+====================================================+")
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERRO: SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.")
        return

    def _ler_tudo(tabela, params_base):
        """Lê tabela com paginacao (limite padrao Supabase = 1000 rows)."""
        resultado, offset = [], 0
        while True:
            lote = _supabase_get(tabela, f"{params_base}&limit=1000&offset={offset}")
            if not lote:
                break
            resultado.extend(lote)
            if len(lote) < 1000:
                break
            offset += 1000
        return resultado

    log("Lendo posts do Supabase...")
    todos_posts_raw = _ler_tudo("posts",
        f"tenant=eq.{TENANT}&select=*&order=data_post.desc")
    log(f"  {len(todos_posts_raw)} posts carregados.")

    log("Lendo comentarios do Supabase...")
    todos_coments_raw = _ler_tudo("comments", f"tenant=eq.{TENANT}&select=*")
    log(f"  {len(todos_coments_raw)} comentarios carregados.")

    # Agrupa comentarios por url do post (formato esperado por analisar_com_agora)
    coments_por_url = {}
    for c in todos_coments_raw:
        url = c.get("url_post", "")
        if url:
            coments_por_url.setdefault(url, []).append({
                "id":       c.get("id", ""),
                "username": c.get("username", ""),
                "texto":    c.get("texto", ""),
                "curtidas": int(c.get("curtidas", 0) or 0),
                "tipo":     c.get("tipo", "cidadao"),
                "data":     c.get("data_comentario", ""),
            })

    # Memoria contextual (sheets; tolerado falhar)
    memoria = ""
    try:
        planilha = conectar_sheets()
        memoria  = carregar_memoria(planilha)
        log("  Memoria carregada do Sheets.")
    except Exception as e:
        log(f"  Sheets indisponivel ({e}) — memoria vazia")

    # Separa por categoria
    posts_oposicao_raw = [p for p in todos_posts_raw
                          if (p.get("categoria") or "").lower() == "oposicao"]
    posts_outros_raw   = [p for p in todos_posts_raw
                          if (p.get("categoria") or "").lower() != "oposicao"]

    log(f"  {len(posts_oposicao_raw)} posts de oposicao → Sonnet com comentarios")
    log(f"  {len(posts_outros_raw)} outros posts → safety net local (sem API)")

    # --- Posts de oposicao: re-analise completa com Sonnet ---
    posts_oposicao = [
        {
            "url":               p.get("url", ""),
            "autor":             p.get("autor", ""),
            "categoria":         p.get("categoria", ""),
            "caption":           p.get("caption", "") or "",
            "data_post":         p.get("data_post", ""),
            "curtidas":          int(p.get("curtidas", 0) or 0),
            "comentarios_total": int(p.get("comentarios_total", 0) or 0),
        }
        for p in posts_oposicao_raw if p.get("url")
    ]
    analisados_oposicao = []
    if posts_oposicao:
        log(f"\nRe-analisando {len(posts_oposicao)} posts de oposicao...")
        mapa_bairros = carregar_bairros(abortar_em_falha=True)
        analisados_oposicao = analisar_com_agora(posts_oposicao, coments_por_url, memoria, mapa_bairros)
        gravar_no_supabase(analisados_oposicao, coments_por_url)
        log(f"  {len(analisados_oposicao)} posts de oposicao gravados.")

    # --- Demais posts: safety net local (sem chamada a Claude) ---
    posts_outros_corrigidos = []
    for p in posts_outros_raw:
        pct_neg = float(p.get("comentarios_pct_neg", 0) or 0)
        pct_pos = float(p.get("comentarios_pct_pos", 0) or 0)
        if pct_neg > 50:
            sentimento = "negativo"
        elif pct_pos > 60:
            sentimento = "positivo"
        else:
            s = p.get("sentimento_post", "neutro") or "neutro"
            sentimento = s if s in ("positivo", "negativo", "neutro") else "neutro"
        posts_outros_corrigidos.append({**p, "sentimento_post": sentimento})

    # --- Recalcula daily_metrics com todos os posts corrigidos ---
    todos_corrigidos = analisados_oposicao + posts_outros_corrigidos
    if todos_corrigidos:
        log(f"\nRecalculando daily_metrics ({len(todos_corrigidos)} posts)...")
        gravar_daily_metrics(todos_corrigidos)

    log("+====================================================+")
    log("|  RETROANALISE concluida.                            |")
    log("+====================================================+")


def teste_localidade():
    """Le 50 comentarios do Supabase e roda APENAS normalizar_localidade() sobre
    o texto de cada um — sem chamar Claude, sem gravar nada no banco/planilha.
    Serve para medir a qualidade do dicionario de aliases de bairros ANTES de
    subir para producao. Nao exige SPREADSHEET_ID (variaveis do Sheets sao lazy)."""
    print("[teste-localidade] Carregando bairros...")
    mapa_bairros = carregar_bairros(abortar_em_falha=False)
    if mapa_bairros == _BAIRRO_FALLBACK_MINIMO:
        print("[teste-localidade] WARNING ALTO: fallback minimo em uso "
              "(leitura de public.bairros falhou ou banco vazio) — resultado nao e confiavel.")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[teste-localidade] SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.")
        return

    print("\n[teste-localidade] Buscando 50 comentários do Supabase…")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/comments",
        params={"tenant": f"eq.{TENANT}", "select": "texto", "limit": "50"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=15,
    )
    if r.status_code != 200:
        print(f"[teste-localidade] Erro ao buscar comentários: {r.status_code} {r.text[:200]}")
        return

    rows = r.json()
    if not rows:
        print("[teste-localidade] Nenhum comentário encontrado no Supabase.")
        return

    total = len(rows)
    resolvidos = nao_identificados = 0
    print(f"\n[teste-localidade] {total} comentários — testando normalizar_localidade():\n")
    for row in rows:
        texto = row.get("texto", "") or ""
        slug = normalizar_localidade(texto, mapa_bairros)
        if slug == "nao_identificado":
            nao_identificados += 1
        else:
            resolvidos += 1
        print(f"  {texto[:60]!r} | {texto!r} | {slug}")

    pct_resolvido = round(resolvidos / total * 100)
    pct_nao_ident = round(nao_identificados / total * 100)
    print(f"\n[teste-localidade] resolvido: {pct_resolvido}% | nao_identificado: {pct_nao_ident}%")
    if pct_nao_ident > 60:
        print("[teste-localidade] ATENÇÃO: nao_identificado > 60% — "
              "o dicionário de aliases de bairros está pobre. Revisar antes de subir para produção.")


def reprocessar():
    """Busca os últimos 20 posts do Supabase e re-analisa com Claude (upsert).
    Não depende do Apify ter um run recente sem erros 429.
    Não coleta comentários novos; usa caption já gravado.
    Não grava no Google Sheets."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[reprocessar] SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.")
        return

    print("[reprocessar] Buscando últimos 20 posts do Supabase…")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/posts",
        params={"tenant": f"eq.{TENANT}", "select": "url,autor,categoria,data_post,curtidas,comentarios_total,caption",
                "order": "data_post.desc", "limit": "20"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=15,
    )
    if r.status_code != 200:
        print(f"[reprocessar] Erro ao buscar posts: {r.status_code} {r.text[:200]}")
        return

    rows = r.json()
    if not rows:
        print("[reprocessar] Nenhum post encontrado no Supabase.")
        return

    posts = [
        {
            "url":           p["url"],
            "autor":         p.get("autor", ""),
            "categoria":     p.get("categoria", ""),
            "data_post":     p.get("data_post", ""),
            "curtidas":      int(p.get("curtidas", 0) or 0),
            "comentarios_total": int(p.get("comentarios_total", 0) or 0),
            "caption":       p.get("caption", "") or "",
        }
        for p in rows
    ]

    print(f"[reprocessar] {len(posts)} posts. Analisando com Claude…")
    # Sem comentarios (dict vazio) — mapa_bairros nao e usado neste fluxo.
    posts_analisados = analisar_com_agora(posts, {}, "", {})

    print(f"[reprocessar] {len(posts_analisados)} posts analisados. Gravando no Supabase (upsert)…")
    gravar_no_supabase(posts_analisados, {})

    print("[reprocessar] Concluído.")


def backfill_comentarios(limite=None):
    """Popula os campos NOVOS (tema/subtema/localidade/pedido/confianca_tema/
    autor_hash) nos comentarios JA existentes no Supabase, sem coletar nada novo.

    Os comentarios gravados antes do Haiku dedicado (Tarefa 5) tem esses campos
    nos defaults ('outro'/'nao_identificado'/null). Este backfill le o texto que
    ja esta la, roda o mesmo analisar_comentarios_haiku por post, aplica a mesma
    normalizacao de analisar_com_agora e faz upsert por id. Nao toca em posts,
    Sheets, alertas ou coleta. Idempotente: rodar de novo so re-classifica.

    autor_hash e populado para TODOS os comentarios (LGPD); a classificacao
    tematica (tema/subtema/localidade/pedido/confianca) so para tipo=cidadao —
    politicos ficam nos defaults, igual ao fluxo normal.
    """
    log("+====================================================+")
    log("|  BACKFILL COMENTARIOS — popula campos novos          |")
    log("+====================================================+")
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERRO: SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.")
        return

    mapa_bairros = carregar_bairros(abortar_em_falha=True)
    log(f"  {len(mapa_bairros)} aliases de bairro carregados do Supabase.")

    # Le TODOS os comentarios do tenant (paginado; limite Supabase = 1000/req)
    todos, offset = [], 0
    while True:
        lote = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&select=id,url_post,autor_post,categoria_post,"
            f"username,tipo,texto,curtidas&order=curtidas.desc&limit=1000&offset={offset}",
        )
        if not lote:
            break
        todos.extend(lote)
        if len(lote) < 1000:
            break
        offset += 1000
    if limite:
        todos = todos[:limite]
    log(f"  {len(todos)} comentarios carregados.")
    if not todos:
        return

    # Agrupa por post (o contexto do post — categoria — decide o LADO no prompt)
    por_post = {}
    for c in todos:
        url = c.get("url_post", "")
        por_post.setdefault(url, []).append(c)
    log(f"  {len(por_post)} posts distintos.")

    cliente = Anthropic(api_key=ANTHROPIC_KEY)
    rows, classificados_tot, i_post = [], 0, 0
    for url, coments in por_post.items():
        i_post += 1
        amostra = coments[0]
        post_ctx = {
            "url": url,
            "autor": amostra.get("autor_post", ""),
            "categoria": amostra.get("categoria_post", ""),
        }
        cidadaos = sorted(
            [c for c in coments if (c.get("tipo") or "") == "cidadao"],
            key=lambda x: int(x.get("curtidas", 0) or 0), reverse=True,
        )
        analise_por_i = analisar_comentarios_haiku(post_ctx, cidadaos, cliente) if cidadaos else {}

        # Cidadaos: classificacao tematica + hash. Mesma logica de analisar_com_agora.
        for idx, c in enumerate(cidadaos):
            item = analise_por_i.get(idx)
            if item:
                tema_c = item.get("tema") or "outro"
                try:
                    conf = int(item.get("confianca_tema") or 0)
                except (TypeError, ValueError):
                    conf = 0
                sent = item.get("sentimento")
                row = {
                    "id": str(c.get("id", "")),
                    "tema": tema_c,
                    "subtema": normalizar_subtema(tema_c, item.get("subtema")),
                    "localidade": normalizar_localidade(item.get("localidade"), mapa_bairros),
                    "pedido": item.get("pedido") or None,
                    "confianca_tema": conf,
                    "autor_hash": hash_autor(TENANT, c.get("username", "")),
                }
                if sent in ("positivo", "negativo", "neutro"):
                    row["sentimento"] = sent
                rows.append(row)
                classificados_tot += 1
            else:
                rows.append({
                    "id": str(c.get("id", "")),
                    "tema": "outro", "subtema": "outro",
                    "localidade": "nao_identificado", "pedido": None,
                    "confianca_tema": 0,
                    "autor_hash": hash_autor(TENANT, c.get("username", "")),
                })

        # Politicos: so autor_hash (LGPD), sem classificacao tematica.
        for c in coments:
            if (c.get("tipo") or "") != "cidadao":
                rows.append({
                    "id": str(c.get("id", "")),
                    "autor_hash": hash_autor(TENANT, c.get("username", "")),
                })

        if i_post % 20 == 0:
            log(f"  ... {i_post}/{len(por_post)} posts processados")

    # Upsert em lotes de 500 (payload PostgREST)
    n_grav = 0
    for k in range(0, len(rows), 500):
        n_grav += _supabase_upsert("comments", rows[k:k + 500], "id")
    log(f"  Backfill concluido: {n_grav} comentarios atualizados "
        f"({classificados_tot} cidadaos classificados pelo Haiku).")


if __name__ == "__main__":
    import sys
    if "--multi-tenant" in sys.argv:
        main_multi_tenant()
    elif "--teste-filtro" in sys.argv:
        teste_filtro()
    elif "--teste-localidade" in sys.argv:
        teste_localidade()
    elif "--backfill-comentarios" in sys.argv:
        # --backfill-comentarios [N]  → N opcional limita quantos comentarios (teste)
        _lim = None
        for _a in sys.argv:
            if _a.isdigit():
                _lim = int(_a)
        backfill_comentarios(limite=_lim)
    elif "--reprocessar" in sys.argv:
        reprocessar()
    elif "--retroanalise" in sys.argv:
        main_retroanalise()
    else:
        main()
