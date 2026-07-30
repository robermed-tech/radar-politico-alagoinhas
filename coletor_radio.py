"""
Coletor de rádio via Apify — captura o stream ao vivo e transcreve.

Ator: radarp_traffic/radio-transcriber (na API REST: radarp_traffic~radio-transcriber).
Ele grava N minutos de cada stream e transcreve com Groq Whisper large-v3, ou
seja, a transcrição já vem pronta e NÃO precisamos de serviço próprio para isso.

Fluxo:
  1. Lê `sources` onde platform='radio' AND active=true.
     → Sem fonte ativa, retorna imediatamente SEM chamar a Apify.
  2. Filtra pela FAIXA HORÁRIA de cada programa (config.hora_inicio/dias).
     O ator grava ao vivo: rodar fora do horário do programa captaria música e
     publicidade, que é o que 90% da grade toca (medido no primeiro teste real).
  3. Uma única chamada de ator para todas as estações da janela, com
     concurrency = nº de estações, para o run durar UM programa e não N.
  4. Normaliza campo-a-campo e grava em `radio_transcripts`; resumo em
     `collection_logs` (platform='radio').

A ANÁLISE não acontece aqui — quem lê as transcrições e extrai as pautas é o
radio_analise.py. A separação é a mesma do Instagram (coleta / módulo 4): coleta
falha por motivo de rede e análise falha por motivo de modelo, e misturar as
duas faria uma retentar a outra.

Modo dry_run: chama a Apify, loga a saída (inclusive as chaves cruas do 1º item,
úteis para recalibrar o mapeamento) e NÃO grava nada.

Mapeamento CALIBRADO em 29/07/2026 contra a saída real do ator
(run hK5Z0gROLJnqagdZo, dataset YBcBZRsx5jWSqRLiw, 4 estações). Campos
confirmados: radio, streamUrl, recordedAt (ISO), durationMinutes, language,
audioStoreKey, transcriptStoreKey, transcription (string|null),
segments [{start,end,text}], status, wordCount, fileSizeMB.

Variáveis de ambiente:
  APIFY_API_TOKEN        — token da Apify
  GROQ_API_KEY           — chave da Groq; o ator a exige no input (required no
                           input_schema). Ele NÃO guarda a chave: quem chama
                           precisa passá-la, então sem este secret não há coleta.
  RADIO_ACTOR_ID         — override do slug do ator (default abaixo)
  SUPABASE_URL           — URL do projeto Supabase
  SUPABASE_SERVICE_KEY   — service role key (bypassa RLS)
  RADAR_TENANT           — tenant (padrão: alagoinhas)
"""

import os
import time
import requests
from datetime import datetime, timedelta, timezone

# ── Config ───────────────────────────────────────────────────────────────────

APIFY_BASE = "https://api.apify.com/v2"

# A configuracao e lida em TEMPO DE CHAMADA, nao no import. Motivo concreto: o
# agora.py chama load_dotenv() DEPOIS de importar este modulo, entao constante
# de modulo lida no import fica vazia quando as credenciais vem de um arquivo
# .env (execucao local). No GitHub Actions passaria, porque lá as variaveis sao
# de ambiente de verdade — ou seja, o bug apareceria so na maquina do
# desenvolvedor, e apareceria como escrita que retorna 0 sem erro nenhum.
# Foi exatamente o que aconteceu no primeiro teste de gravacao.

def _apify_token() -> str:
    return os.environ.get("APIFY_API_TOKEN", "")


def _groq_key() -> str:
    return os.environ.get("GROQ_API_KEY", "")


def _actor_radio() -> str:
    """Slug do ator na Apify Store (username~actor-name na API REST)."""
    return os.environ.get("RADIO_ACTOR_ID", "radarp_traffic~radio-transcriber")


def _supabase() -> tuple[str, str]:
    return (os.environ.get("SUPABASE_URL", "").rstrip("/"),
            os.environ.get("SUPABASE_SERVICE_KEY", ""))


def _tenant() -> str:
    return os.environ.get("RADAR_TENANT", "alagoinhas")

# Duração default da captura, quando a fonte não define config.duracao_min.
# Deliberadamente menor que o default do ator (60): o ator grava em TEMPO REAL,
# então cada minuto de captura é um minuto de run pago na Apify. Com o teto
# mensal apertado (ver pendencia_apify_teto_estourado), 30 min de miolo de
# programa rendem mais que 60 min incluindo bloco musical.
DURACAO_MIN_DEFAULT = 30

# Tolerância para o run começar depois do início do programa. O cron do Actions
# não é pontual, e um atraso de alguns minutos não deve cancelar a captura.
TOLERANCIA_MIN = 20

# A Apify limita concurrency a 4 no input_schema deste ator.
MAX_CONCURRENCY = 4

_DIAS_SEMANA = ("seg", "ter", "qua", "qui", "sex", "sab", "dom")


def _log(msg: str) -> None:
    # Resiliente ao encoding do console: no Actions (Linux/UTF-8) mantém os
    # símbolos; num terminal Windows cp1252 degrada em vez de derrubar o run.
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


# ── Apify (helpers próprios — módulo standalone, sem import circular) ─────────

def _apify_iniciar_run(actor_id: str, input_data: dict, memory_mbytes: int = 512) -> str | None:
    url = f"{APIFY_BASE}/acts/{actor_id}/runs"
    params = {"token": _apify_token(), "memory": memory_mbytes}
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


def _apify_aguardar_run(run_id: str, timeout: int) -> str | None:
    """Aguarda o run terminar. `timeout` é OBRIGATÓRIO aqui, diferente dos
    outros coletores: o ator grava em tempo real, então um run de 30 minutos de
    captura leva mais de 30 minutos. O default de 300 s dos coletores de
    Instagram/YouTube abandonaria toda captura maior que 5 minutos — e, pior,
    abandonaria depois de o run já ter consumido o crédito."""
    url = f"{APIFY_BASE}/actor-runs/{run_id}"
    params = {"token": _apify_token()}
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
        time.sleep(15)
    _log(f"    Run {run_id}: timeout após {timeout}s")
    return None


def _apify_buscar_resultados(dataset_id: str, limit: int = 100) -> list:
    url = f"{APIFY_BASE}/datasets/{dataset_id}/items"
    params = {"token": _apify_token(), "limit": limit, "format": "json"}
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
    _, key = _supabase()
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _supabase_get(tabela: str, params: str) -> list:
    url, key = _supabase()
    if not url or not key:
        return []
    try:
        r = requests.get(f"{url}/rest/v1/{tabela}?{params}",
                         headers=_sb_headers(), timeout=15)
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        _log(f"    Supabase GET {tabela}: erro {e}")
        return []


def _supabase_upsert(tabela: str, linhas: list, on_conflict: str) -> int:
    base, key = _supabase()
    if not base or not key or not linhas:
        return 0
    url = f"{base}/rest/v1/{tabela}?on_conflict={on_conflict}"
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
    base, key = _supabase()
    if not base or not key or not linhas:
        return 0
    url = f"{base}/rest/v1/{tabela}"
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


# ── Janela horária (funções puras — testadas no __main__) ────────────────────

def _hhmm_para_minutos(valor: str) -> int | None:
    """'07:30' → 450. None quando não parseia (não inventa horário)."""
    try:
        h, m = str(valor).strip().split(":")[:2]
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h * 60 + m


def dentro_da_janela(config: dict | None, agora: datetime) -> tuple[bool, str]:
    """Decide se AGORA é hora de capturar este programa. Devolve (pode, motivo).

    Fonte sem `hora_inicio` cadastrado captura sempre — quem não configurou
    janela pediu captura a cada execução, e recusar por omissão deixaria a
    estação muda sem dizer por quê.

    A janela vai de hora_inicio até hora_inicio + TOLERANCIA_MIN. Ela é o
    momento de COMEÇAR a gravar, não a duração da gravação: a captura em si se
    estende por duracao_min depois disso.
    """
    cfg = config or {}
    inicio = _hhmm_para_minutos(cfg.get("hora_inicio") or "")
    if inicio is None:
        return True, "sem faixa horaria cadastrada"

    dias = cfg.get("dias") or []
    if dias:
        hoje = _DIAS_SEMANA[agora.weekday()]
        if hoje not in [str(d).strip().lower()[:3] for d in dias]:
            return False, f"hoje ({hoje}) fora dos dias do programa"

    atual = agora.hour * 60 + agora.minute
    if inicio <= atual <= inicio + TOLERANCIA_MIN:
        return True, f"dentro da janela {cfg.get('hora_inicio')} (+{TOLERANCIA_MIN}min)"
    return False, f"fora da janela {cfg.get('hora_inicio')} (agora {agora:%H:%M})"


# ── Normalização campo-a-campo ───────────────────────────────────────────────

def _pega(item: dict, *chaves, padrao=None):
    """Primeira chave presente e não-nula. Absorve variação de nomes entre
    versões do ator."""
    for c in chaves:
        if isinstance(item, dict) and item.get(c) is not None:
            return item[c]
    return padrao


def _iso(ts_raw) -> str | None:
    """ISO do ator → ISO normalizado com fuso. None se não parsear: inventar
    horário de captura arruinaria a chave de idempotência."""
    if not ts_raw:
        return None
    try:
        dt = datetime.fromisoformat(str(ts_raw).strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return None


def normalizar_bloco(item: dict, fonte: dict | None) -> dict | None:
    """Um item do dataset do ator → uma linha de `radio_transcripts`.

    Devolve None só quando falta o essencial (estação ou horário de captura),
    porque sem os dois não há chave de idempotência. Bloco que FALHOU no ator é
    gravado normalmente, com status e transcrição vazia: é justamente o registro
    que permite à tela dizer "não captada" em vez de "sem assunto".
    """
    estacao = (_pega(item, "radio", "name", "station", padrao="") or "").strip()
    inicio = _iso(_pega(item, "recordedAt", "startedAt", "date"))
    if not estacao or not inicio:
        return None

    cfg = (fonte or {}).get("config") or {}
    segments = _pega(item, "segments", padrao=[]) or []
    transcricao = _pega(item, "transcription", "text", padrao="") or ""

    return {
        "tenant":               _tenant(),
        "source_id":            (fonte or {}).get("id"),
        "estacao":              estacao,
        "programa":             cfg.get("programa"),
        "stream_url":           _pega(item, "streamUrl", "url", padrao=""),
        "inicio_ts":            inicio,
        "duracao_min":          _pega(item, "durationMinutes", padrao=None),
        "status":               (_pega(item, "status", padrao="SUCCESS") or "SUCCESS"),
        "palavras":             int(_pega(item, "wordCount", padrao=0) or 0),
        "transcricao":          transcricao or None,
        "segments":             segments,
        "audio_store_key":      _pega(item, "audioStoreKey", padrao=""),
        "transcript_store_key": _pega(item, "transcriptStoreKey", padrao=""),
    }


def _input_radio(radios: list[dict], duracao_min: int) -> dict:
    """Input do ator. `concurrency` = nº de estações (teto 4) de propósito: o
    ator grava em tempo real, então gravar em série faria o run durar
    N × duracao_min. Em paralelo o run dura uma captura só."""
    return {
        "radios": radios,
        "durationMinutes": duracao_min,
        "language": "pt",
        "groqApiKey": _groq_key(),
        "concurrency": max(1, min(MAX_CONCURRENCY, len(radios))),
    }


# ── Coleta ───────────────────────────────────────────────────────────────────

def _fontes_ativas() -> list[dict]:
    """Rádios ativas da tabela `sources`."""
    return _supabase_get(
        "sources",
        "platform=eq.radio&active=eq.true&select=id,handle,label,config",
    )


def _log_collection(source_id, items_count: int, status: str, dry_run: bool) -> None:
    if dry_run:
        _log(f"    [DRY-RUN] collection_logs: blocos={items_count} status={status}")
        return
    _supabase_insert("collection_logs", [{
        "source_id": source_id,
        "platform": "radio",
        "data_type": "transcricoes",
        "items_count": items_count,
        "status": status,
    }])


def _duracao_da_janela(fontes: list[dict]) -> int:
    """Uma chamada de ator cobre várias estações com UMA duração. Usa a MENOR
    duração cadastrada entre as estações da janela: gravar além do fim do
    programa mais curto captaria a grade musical seguinte, e é mais barato."""
    duracoes = []
    for f in fontes:
        try:
            d = int(((f.get("config") or {}).get("duracao_min")) or 0)
        except (TypeError, ValueError):
            d = 0
        if d > 0:
            duracoes.append(d)
    return min(duracoes) if duracoes else DURACAO_MIN_DEFAULT


def coletar_e_gravar(
    dry_run: bool = False,
    ignorar_janela: bool = False,
    somente_ids: list[str] | None = None,
    duracao_min: int | None = None,
) -> dict:
    """Ponto de entrada chamado pelo agora.py.

    ignorar_janela: só para teste manual — captura mesmo fora do horário do
    programa. Em produção a janela é respeitada, senão o ator grava música.

    somente_ids / duracao_min: gravação sob demanda pedida no painel (botão
    GRAVAR da Escuta do Rádio). O usuário escolhe as estações e por quanto
    tempo, e o horário do programa não se aplica — ele está pedindo AGORA.
    Por isso `somente_ids` implica ignorar a janela: exigir as duas coisas
    faria o botão falhar em silêncio fora do horário cadastrado, que é
    justamente quando alguém aperta um botão de gravar.
    """
    if somente_ids:
        ignorar_janela = True
    if not _apify_token():
        _log("[radio] APIFY_API_TOKEN ausente — coleta de rádio ignorada")
        return {"fontes": 0, "blocos": 0, "skipped": True}
    if not _groq_key():
        # O ator declara groqApiKey como required e não guarda a chave: chamar
        # sem ela queimaria um run que falha na largada.
        _log("[radio] GROQ_API_KEY ausente — o ator exige a chave no input. "
             "Cadastre o secret antes de ativar a coleta de radio.")
        return {"fontes": 0, "blocos": 0, "skipped": True}

    fontes = _fontes_ativas()
    if somente_ids:
        pedidas = {str(i) for i in somente_ids}
        fontes = [f for f in fontes if str(f.get("id")) in pedidas]
        if not fontes:
            # Estação pedida que não está ativa não é "nada a coletar": é um
            # pedido que não pode ser atendido, e o log tem que dizer isso.
            _log(f"[radio] Nenhuma das {len(pedidas)} estacao(oes) pedidas esta ativa")
            return {"fontes": 0, "blocos": 0, "skipped": True}
    if not fontes:
        _log("[radio] Nenhuma radio ativa — nada a coletar (sistema inerte)")
        return {"fontes": 0, "blocos": 0, "skipped": True}

    agora = datetime.now()
    na_janela = []
    for f in fontes:
        if ignorar_janela:
            na_janela.append(f)
            continue
        pode, motivo = dentro_da_janela(f.get("config"), agora)
        rotulo = f.get("label") or f.get("handle")
        if pode:
            na_janela.append(f)
        else:
            _log(f"  · {rotulo}: {motivo}")
    if not na_janela:
        _log(f"[radio] {len(fontes)} radio(s) ativa(s), nenhuma na janela de captura agora")
        return {"fontes": len(fontes), "blocos": 0, "skipped": True}

    # Duração pedida no painel vence a do cadastro. Teto de 60 min porque cada
    # minuto de captura é um minuto pago de run na Apify (o ator grava em tempo
    # real), e o timeout do step do radio.yml é 65.
    duracao = max(1, min(60, int(duracao_min))) if duracao_min else _duracao_da_janela(na_janela)
    radios_input, fonte_por_nome = [], {}
    for f in na_janela:
        nome = (f.get("label") or f.get("handle") or "").strip()
        radios_input.append({"name": nome, "streamUrl": f.get("handle")})
        fonte_por_nome[nome] = f

    _log(f"=== Coletor Radio — {len(radios_input)} estacao(oes), "
         f"{duracao} min de captura{' [DRY-RUN]' if dry_run else ''} ===")
    for r in radios_input:
        _log(f"  → {r['name']} ({r['streamUrl']})")

    run_id = _apify_iniciar_run(_actor_radio(), _input_radio(radios_input, duracao))
    if not run_id:
        for f in na_janela:
            _log_collection(f.get("id"), 0, "erro", dry_run)
        return {"fontes": len(na_janela), "blocos": 0, "erros": len(na_janela), "skipped": False}

    # O run dura a captura inteira mais o tempo de transcrição. A folga de 10
    # min cobre o Whisper e a subida do áudio ao KV store.
    timeout = duracao * 60 + 600
    _log(f"    Run {run_id} iniciado — aguardando ate {timeout // 60} min "
         "(a gravacao acontece em tempo real)")
    dataset_id = _apify_aguardar_run(run_id, timeout=timeout)
    brutos = _apify_buscar_resultados(dataset_id) if dataset_id else []
    _log(f"    {len(brutos)} bloco(s) bruto(s)")

    if dry_run and brutos:
        _log(f"    [DRY-RUN] chaves do 1º bloco cru: {sorted(brutos[0].keys())}")

    linhas, falhas = [], 0
    for item in brutos:
        fonte = fonte_por_nome.get((_pega(item, "radio", padrao="") or "").strip())
        linha = normalizar_bloco(item, fonte)
        if not linha:
            _log(f"    ⚠ bloco sem estacao/horario — ignorado: {str(item)[:120]}")
            continue
        linha["apify_run_id"] = run_id
        linha["raw"] = item
        if linha["status"] != "SUCCESS":
            falhas += 1
            _log(f"    ⚠ {linha['estacao']}: status {linha['status']} "
                 "(gravado como nao captada)")
        linhas.append(linha)

    if dry_run:
        for l in linhas:
            _log(f"    [DRY-RUN] {l['estacao']} | {l['inicio_ts']} | {l['status']} | "
                 f"{l['palavras']} palavras | {len(l['segments'])} segmentos")
            if l["transcricao"]:
                _log(f"              inicio: {l['transcricao'][:160]}…")
        _log(f"    [DRY-RUN] {len(linhas)} bloco(s) NAO gravados")
        return {"fontes": len(na_janela), "blocos": len(linhas), "skipped": False,
                "dry_run": True}

    n = _supabase_upsert("radio_transcripts", linhas, "tenant,estacao,inicio_ts")
    _log(f"    Gravados: {n} bloco(s) ({falhas} com falha de captura)")
    for f in na_janela:
        nome = (f.get("label") or f.get("handle") or "").strip()
        desta = [l for l in linhas if l["estacao"] == nome]
        ok = any(l["status"] == "SUCCESS" for l in desta)
        _log_collection(f.get("id"), len(desta),
                        "ok" if ok else ("erro" if desta else "vazio"), dry_run)

    return {"fontes": len(na_janela), "blocos": n, "falhas": falhas, "skipped": False}


# ── Execução isolada / autoteste ─────────────────────────────────────────────

def _autoteste() -> None:
    """Testes das funções puras de janela horária. Zero rede, zero custo."""
    assert _hhmm_para_minutos("07:30") == 450
    assert _hhmm_para_minutos("00:00") == 0
    assert _hhmm_para_minutos("24:00") is None
    assert _hhmm_para_minutos("7h30") is None
    assert _hhmm_para_minutos(None) is None

    seg_8h = datetime(2026, 7, 27, 8, 0)      # segunda-feira
    dom_8h = datetime(2026, 8, 2, 8, 0)       # domingo

    # Sem config: captura sempre (quem não configurou não pediu restrição).
    assert dentro_da_janela(None, seg_8h)[0] is True
    assert dentro_da_janela({}, seg_8h)[0] is True

    cfg = {"hora_inicio": "08:00", "dias": ["seg", "ter", "qua", "qui", "sex"]}
    assert dentro_da_janela(cfg, seg_8h)[0] is True
    # Atraso do cron dentro da tolerância ainda captura.
    assert dentro_da_janela(cfg, seg_8h + timedelta(minutes=15))[0] is True
    # Passada a tolerância, não: começar a gravar às 8h40 pegaria outro bloco.
    assert dentro_da_janela(cfg, seg_8h + timedelta(minutes=40))[0] is False
    assert dentro_da_janela(cfg, seg_8h - timedelta(minutes=5))[0] is False
    # Dia fora da grade do programa.
    assert dentro_da_janela(cfg, dom_8h)[0] is False
    # Grade só de fim de semana.
    assert dentro_da_janela({"hora_inicio": "08:00", "dias": ["sab", "dom"]}, dom_8h)[0] is True

    # Duração da janela: a menor cadastrada manda; sem cadastro, o default.
    assert _duracao_da_janela([{"config": {"duracao_min": 60}},
                               {"config": {"duracao_min": 25}}]) == 25
    assert _duracao_da_janela([{"config": {}}]) == DURACAO_MIN_DEFAULT
    assert _duracao_da_janela([{"config": {"duracao_min": "abc"}}]) == DURACAO_MIN_DEFAULT

    # Normalização: bloco sem estação ou sem horário não tem chave e é recusado.
    assert normalizar_bloco({"radio": "X"}, None) is None
    assert normalizar_bloco({"recordedAt": "2026-07-29T19:38:58.079Z"}, None) is None
    # Bloco que falhou no ator É normalizado (é o registro de "não captada").
    falho = normalizar_bloco(
        {"radio": "Radio Boa 94.1 FM", "recordedAt": "2026-07-29T19:44:05.346Z",
         "status": "RECORDING_FAILED", "transcription": None, "segments": [],
         "wordCount": 0},
        {"id": "abc", "config": {"programa": "Manha"}})
    assert falho is not None
    assert falho["status"] == "RECORDING_FAILED"
    assert falho["transcricao"] is None
    assert falho["programa"] == "Manha"
    print("coletor_radio: autoteste OK")


if __name__ == "__main__":
    import sys
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    if "--autoteste" in sys.argv:
        _autoteste()
        raise SystemExit(0)

    coletar_e_gravar(dry_run="--dry-run" in sys.argv or "--dry" in sys.argv,
                     ignorar_janela="--agora" in sys.argv)
