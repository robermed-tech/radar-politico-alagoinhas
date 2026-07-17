"""
Coletor YouTube via Apify — subsistema novo de coleta multi-plataforma.

Espelha o padrão do coletor de Instagram (coletor_instagram.py), mas com uma
responsabilidade a mais: além de coletar e normalizar, este módulo GRAVA os
dados na mesma tabela `posts` que o agora.py já usa (platform='youtube') e nos
`comments`, e registra o resumo de cada execução em `collection_logs`.

Fluxo:
  1. Lê `sources` onde platform='youtube' AND active=true.
     → Se não houver nenhuma fonte ativa, retorna imediatamente SEM chamar a
       Apify (o sistema fica inerte até o admin ativar uma fonte).
  2. Para cada canal (isolado em try/except):
     - streamers/youtube-scraper          → vídeos recentes do canal
     - streamers/youtube-comments-scraper → comentários desses vídeos
  3. Normaliza campo-a-campo (funções normalizar_video / normalizar_comentario),
     guardando o payload cru em `raw`.
  4. Grava em posts (platform='youtube') + comments, e loga em collection_logs.
     Falha de uma fonte vira status='erro' no log e NÃO derruba as outras.

Modo dry_run: busca da Apify e loga a saída (inclui as chaves cruas, úteis p/
ajustar o mapeamento depois de um teste real), mas NÃO grava nada.

⚠ Os nomes dos campos dos atores streamers/* mudam entre versões. Todo o
mapeamento está isolado em normalizar_video() / normalizar_comentario() e nos
builders _input_videos() / _input_comentarios() — é aqui que se ajusta depois
de inspecionar a saída real com dry_run.

Variáveis de ambiente (as mesmas do agora.py):
  APIFY_API_TOKEN        — token da Apify
  SUPABASE_URL           — URL do projeto Supabase
  SUPABASE_SERVICE_KEY   — service role key (bypassa RLS)
  RADAR_TENANT           — tenant (padrão: alagoinhas)
"""

import os
import time
import requests
from datetime import datetime, timedelta, timezone

# ── Config ───────────────────────────────────────────────────────────────────

APIFY_TOKEN = os.environ.get("APIFY_API_TOKEN", "")
APIFY_BASE  = "https://api.apify.com/v2"

# Slugs da Apify Store: streamers/youtube-scraper e streamers/youtube-comments-scraper.
# Na API REST o separador é "~" (username~actor-name).
ACTOR_VIDEOS   = "streamers~youtube-scraper"
ACTOR_COMMENTS = "streamers~youtube-comments-scraper"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT       = os.environ.get("RADAR_TENANT", "alagoinhas")

MAX_VIDEOS_POR_CANAL     = 10    # vídeos mais recentes por canal
MAX_COMENTARIOS_POR_VIDEO = 100  # comentários por vídeo
DIAS_ATRAS               = 7     # ignora vídeos mais antigos que isto


def _log(msg: str) -> None:
    print(msg, flush=True)


# ── Apify (helpers próprios — módulo standalone, sem import circular) ─────────

def _apify_iniciar_run(actor_id: str, input_data: dict, memory_mbytes: int = 512) -> str | None:
    url = f"{APIFY_BASE}/acts/{actor_id}/runs"
    params = {"token": APIFY_TOKEN, "memory": memory_mbytes}
    try:
        r = requests.post(url, params=params, json=input_data, timeout=30)
        if r.status_code == 402 or "Monthly usage hard limit" in r.text:
            _log("    [APIFY — LIMITE MENSAL ATINGIDO] recarregue em apify.com/billing")
            return None
        if r.status_code not in (200, 201):
            _log(f"    Erro ao iniciar actor {actor_id}: {r.status_code} | {r.text[:200]}")
            return None
        return r.json().get("data", {}).get("id")
    except Exception as e:
        _log(f"    Erro ao iniciar actor {actor_id}: {e}")
        return None


def _apify_aguardar_run(run_id: str, timeout: int = 300) -> str | None:
    url = f"{APIFY_BASE}/actor-runs/{run_id}"
    params = {"token": APIFY_TOKEN}
    inicio = time.time()
    while time.time() - inicio < timeout:
        try:
            r = requests.get(url, params=params, timeout=30)
            data = r.json().get("data", {})
            status = data.get("status")
            if status == "SUCCEEDED":
                return data.get("defaultDatasetId")
            if status in ("FAILED", "ABORTED", "TIMED-OUT"):
                _log(f"    Run {run_id} terminou com status {status}")
                return None
        except Exception as e:
            _log(f"    Erro ao consultar run {run_id}: {e}")
        time.sleep(5)
    _log(f"    Run {run_id}: timeout após {timeout}s")
    return None


def _apify_buscar_resultados(dataset_id: str, limit: int = 500) -> list:
    url = f"{APIFY_BASE}/datasets/{dataset_id}/items"
    params = {"token": APIFY_TOKEN, "limit": limit, "format": "json"}
    try:
        r = requests.get(url, params=params, timeout=60)
        if r.status_code != 200:
            _log(f"    Erro ao buscar dataset {dataset_id}: {r.status_code}")
            return []
        return r.json()
    except Exception as e:
        _log(f"    Erro ao buscar dataset {dataset_id}: {e}")
        return []


# ── Supabase REST (helpers próprios) ─────────────────────────────────────────

def _sb_headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _supabase_get(tabela: str, params: str) -> list:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{tabela}?{params}",
                         headers=_sb_headers(), timeout=15)
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        _log(f"    Supabase GET {tabela}: erro {e}")
        return []


def _supabase_upsert(tabela: str, linhas: list, on_conflict: str) -> int:
    if not SUPABASE_URL or not SUPABASE_KEY or not linhas:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?on_conflict={on_conflict}"
    headers = _sb_headers({"Prefer": "resolution=merge-duplicates,return=minimal"})
    try:
        r = requests.post(url, headers=headers, json=linhas, timeout=30)
        if r.status_code not in (200, 201, 204):
            _log(f"    Supabase {tabela}: HTTP {r.status_code} {r.text[:160]}")
            return 0
        return len(linhas)
    except Exception as e:
        _log(f"    Supabase {tabela}: erro {e}")
        return 0


def _supabase_insert(tabela: str, linhas: list) -> int:
    if not SUPABASE_URL or not SUPABASE_KEY or not linhas:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{tabela}"
    headers = _sb_headers({"Prefer": "return=minimal"})
    try:
        r = requests.post(url, headers=headers, json=linhas, timeout=30)
        if r.status_code not in (200, 201, 204):
            _log(f"    Supabase {tabela}: HTTP {r.status_code} {r.text[:160]}")
            return 0
        return len(linhas)
    except Exception as e:
        _log(f"    Supabase {tabela}: erro {e}")
        return 0


# ── Utilidades de mapeamento ─────────────────────────────────────────────────

def _pega(item: dict, *chaves, padrao=None):
    """Primeira chave presente e não-nula. Absorve a variação de nomes entre
    versões dos atores streamers/*."""
    for c in chaves:
        if isinstance(item, dict) and item.get(c) is not None:
            return item[c]
    return padrao


def _canal_url(handle: str) -> str:
    """Monta a URL do canal a partir do handle já normalizado pelo front
    (@handle, channel/UC…, c/Nome, user/Nome)."""
    return f"https://www.youtube.com/{handle.lstrip('/')}"


def _data_br(ts_raw) -> str:
    """ISO/epoch → 'dd/mm/yyyy' (formato que o dashboard usa em data_post).
    String vazia se não parsear (nunca inventa data)."""
    if not ts_raw:
        return ""
    try:
        if isinstance(ts_raw, (int, float)):
            dt = datetime.fromtimestamp(ts_raw, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(ts_raw).strip().replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return ""


def _dentro_do_periodo(ts_raw, dias: int = DIAS_ATRAS) -> bool:
    """True se o vídeo é dos últimos `dias`. Na dúvida (data ausente/inválida)
    retorna True — melhor coletar a mais do que descartar por parsing frágil."""
    if not ts_raw:
        return True
    try:
        if isinstance(ts_raw, (int, float)):
            dt = datetime.fromtimestamp(ts_raw, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(ts_raw).strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt >= datetime.now(timezone.utc) - timedelta(days=dias)
    except Exception:
        return True


# ── Normalização campo-a-campo (AJUSTAR após teste real com dry_run) ──────────

def normalizar_video(item: dict) -> dict | None:
    """Mapeia um item cru do streamers/youtube-scraper para uma linha de `posts`.
    Guarda o payload cru em `raw`. Retorna None se não houver URL (sem chave)."""
    url = _pega(item, "url", "videoUrl", "watchUrl")
    video_id = _pega(item, "id", "videoId")
    if not url and video_id:
        url = f"https://www.youtube.com/watch?v={video_id}"
    if not url:
        return None

    titulo = _pega(item, "title", "videoTitle", padrao="") or ""
    descricao = _pega(item, "text", "description", padrao="") or ""
    canal = _pega(item, "channelName", "channelUsername", "channelTitle",
                  "author", padrao="") or ""
    data_raw = _pega(item, "date", "uploadDate", "publishedAt", "publishDate")

    return {
        "url": url,
        "tenant": TENANT,
        "platform": "youtube",
        "data_post": _data_br(data_raw),
        "autor": canal,
        "categoria": "",
        "curtidas": int(_pega(item, "likes", "likeCount", padrao=0) or 0),
        "comentarios_total": int(_pega(item, "commentsCount", "numberOfComments",
                                        "commentCount", padrao=0) or 0),
        # caption = título + descrição (limitada), espelhando o campo do Instagram.
        "caption": (f"{titulo}\n{descricao}".strip())[:500],
        "raw": item,
        "atualizado_em": datetime.now().isoformat(),
    }, url


def normalizar_comentario(item: dict, url_post: str) -> dict | None:
    """Mapeia um item cru do streamers/youtube-comments-scraper para uma linha
    de `comments`. Retorna None se não houver id (chave primária)."""
    cid = _pega(item, "cid", "commentId", "id")
    if not cid:
        return None
    texto = _pega(item, "text", "comment", "content", padrao="") or ""
    autor = _pega(item, "author", "authorName", "username", padrao="") or ""
    return {
        "id": str(cid),
        "tenant": TENANT,
        "url_post": url_post,
        "username": autor.lstrip("@"),
        "tipo": "cidadao",
        "texto": texto[:300],
        "curtidas": int(_pega(item, "voteCount", "likes", "likesCount", padrao=0) or 0),
        "data_comentario": str(_pega(item, "publishedTimeText", "date", "publishedAt",
                                     padrao="") or ""),
        "atualizado_em": datetime.now().isoformat(),
    }


def _input_videos(channel_url: str) -> dict:
    """Input do streamers/youtube-scraper. AJUSTAR conforme a versão do ator."""
    return {
        "startUrls": [{"url": channel_url}],
        "maxResults": MAX_VIDEOS_POR_CANAL,
        "maxResultsShorts": 0,
        "sortVideosBy": "NEWEST",
    }


def _input_comentarios(video_urls: list[str]) -> dict:
    """Input do streamers/youtube-comments-scraper. AJUSTAR conforme a versão."""
    return {
        "startUrls": [{"url": u} for u in video_urls],
        "maxComments": MAX_COMENTARIOS_POR_VIDEO,
    }


# ── Coleta ───────────────────────────────────────────────────────────────────

def _fontes_ativas() -> list[dict]:
    """Fontes YouTube ativas da tabela `sources`."""
    return _supabase_get(
        "sources",
        "platform=eq.youtube&active=eq.true&select=id,handle,label",
    )


def _log_collection(source_id, data_type: str, items_count: int, status: str,
                    dry_run: bool) -> None:
    """Registra o resumo da execução em collection_logs (no-op em dry_run)."""
    if dry_run:
        _log(f"    [DRY-RUN] collection_logs: {data_type} count={items_count} status={status}")
        return
    _supabase_insert("collection_logs", [{
        "source_id": source_id,
        "platform": "youtube",
        "data_type": data_type,
        "items_count": items_count,
        "status": status,
    }])


def _coletar_fonte(fonte: dict, dry_run: bool) -> dict:
    """Coleta vídeos + comentários de UM canal e grava (ou loga, em dry_run).
    Toda exceção é contida aqui: status='erro' no log e segue para a próxima."""
    source_id = fonte.get("id")
    handle = fonte.get("handle", "")
    rotulo = fonte.get("label") or handle
    channel_url = _canal_url(handle)
    _log(f"  → Canal: {rotulo} ({channel_url})")

    # 1. Vídeos ------------------------------------------------------
    run_id = _apify_iniciar_run(ACTOR_VIDEOS, _input_videos(channel_url), memory_mbytes=1024)
    if not run_id:
        _log_collection(source_id, "videos", 0, "erro", dry_run)
        return {"videos": 0, "comentarios": 0, "status": "erro"}
    dataset_id = _apify_aguardar_run(run_id)
    brutos_videos = _apify_buscar_resultados(dataset_id) if dataset_id else []
    _log(f"    {len(brutos_videos)} vídeos brutos")

    posts_rows, video_urls = [], []
    for item in brutos_videos:
        data_raw = _pega(item, "date", "uploadDate", "publishedAt", "publishDate")
        if not _dentro_do_periodo(data_raw):
            continue
        norm = normalizar_video(item)
        if not norm:
            continue
        row, url = norm
        posts_rows.append(row)
        video_urls.append(url)

    _log(f"    {len(posts_rows)} vídeos dentro do período ({DIAS_ATRAS}d)")

    # 2. Comentários -------------------------------------------------
    coment_rows = []
    if video_urls:
        run_id_c = _apify_iniciar_run(ACTOR_COMMENTS, _input_comentarios(video_urls), memory_mbytes=512)
        if run_id_c:
            dataset_c = _apify_aguardar_run(run_id_c)
            brutos_coment = _apify_buscar_resultados(dataset_c, limit=2000) if dataset_c else []
            _log(f"    {len(brutos_coment)} comentários brutos")
            for item in brutos_coment:
                url_post = _pega(item, "url", "videoUrl", "postUrl") or (video_urls[0] if video_urls else "")
                # Casa o comentário com um vídeo coletado (o ator devolve a URL do vídeo).
                url_post = next((u for u in video_urls if url_post and (u == url_post or u in url_post)), url_post)
                if url_post not in video_urls:
                    continue
                c = normalizar_comentario(item, url_post)
                if c:
                    coment_rows.append(c)

    # 3. Grava (ou loga, em dry_run) ---------------------------------
    if dry_run:
        _log(f"    [DRY-RUN] {len(posts_rows)} posts + {len(coment_rows)} comentários (NÃO gravados)")
        if brutos_videos:
            _log(f"    [DRY-RUN] chaves do 1º vídeo cru: {sorted(brutos_videos[0].keys())}")
        if posts_rows:
            _amostra = {k: posts_rows[0][k] for k in ("url", "autor", "data_post", "curtidas", "comentarios_total")}
            _log(f"    [DRY-RUN] amostra normalizada: {_amostra}")
        _log_collection(source_id, "videos", len(posts_rows), "ok" if posts_rows else "vazio", dry_run)
        _log_collection(source_id, "comments", len(coment_rows), "ok" if coment_rows else "vazio", dry_run)
        return {"videos": len(posts_rows), "comentarios": len(coment_rows), "status": "dry_run"}

    # posts antes de comments (comments.url_post é FK → posts.url).
    n_posts = _supabase_upsert("posts", posts_rows, "url")
    n_coments = _supabase_upsert("comments", coment_rows, "id")
    _log(f"    Gravados: {n_posts} vídeos, {n_coments} comentários")
    _log_collection(source_id, "videos", n_posts, "ok" if n_posts else "vazio", dry_run)
    _log_collection(source_id, "comments", n_coments, "ok" if n_coments else "vazio", dry_run)
    return {"videos": n_posts, "comentarios": n_coments, "status": "ok"}


def coletar_e_gravar(dry_run: bool = False) -> dict:
    """Ponto de entrada chamado pelo agora.py.

    Lê as fontes YouTube ativas e coleta cada uma. Se não houver nenhuma fonte
    ativa, retorna imediatamente SEM chamar a Apify (sistema inerte).
    Retorna um resumo agregado da execução.
    """
    if not APIFY_TOKEN:
        _log("[youtube] APIFY_API_TOKEN ausente — coleta YouTube ignorada")
        return {"fontes": 0, "videos": 0, "comentarios": 0, "skipped": True}

    fontes = _fontes_ativas()
    if not fontes:
        _log("[youtube] Nenhuma fonte YouTube ativa — nada a coletar (sistema inerte)")
        return {"fontes": 0, "videos": 0, "comentarios": 0, "skipped": True}

    _log(f"=== Coletor YouTube — {len(fontes)} fonte(s) ativa(s){' [DRY-RUN]' if dry_run else ''} ===")
    total_v, total_c, erros = 0, 0, 0
    for fonte in fontes:
        try:
            res = _coletar_fonte(fonte, dry_run)
            total_v += res["videos"]
            total_c += res["comentarios"]
            if res["status"] == "erro":
                erros += 1
        except Exception as e:
            # Isola a falha: registra e segue para a próxima fonte.
            _log(f"  ⚠ Fonte {fonte.get('handle')} falhou: {e}")
            _log_collection(fonte.get("id"), "videos", 0, "erro", dry_run)
            erros += 1

    _log(f"[youtube] Total: {total_v} vídeos, {total_c} comentários, {erros} fonte(s) com erro")
    return {"fontes": len(fontes), "videos": total_v, "comentarios": total_c,
            "erros": erros, "skipped": False}


# ── Execução isolada (teste manual) ──────────────────────────────────────────

if __name__ == "__main__":
    import sys
    _dry = "--dry-run" in sys.argv or "--dry" in sys.argv
    coletar_e_gravar(dry_run=_dry)
