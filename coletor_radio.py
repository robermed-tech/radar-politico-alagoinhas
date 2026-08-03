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
     Estação sem hora_inicio cadastrado fica FORA da captação automática — a
     regra do produto é gravar só no horário pré-determinado ou sob demanda
     (botão GRAVAR do painel); gravação 24h ou "a cada execução" não existe.
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

import math
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

# Folga sobre o tempo de GRAVAÇÃO, para esperar o ator transcrever cada bloco e
# subir o áudio ao key-value store.
#
# Era uma folga fixa de 600 s, e 600 s não bastaram: medido em 31/07/26, um run
# de 4 estações × 30 min levou 41min51s (2511 s), ou seja 711 s de overhead. O
# coletor desistiu aos 2400 s e o run terminou SUCCEEDED 102 segundos depois —
# crédito pago, transcrição pronta no dataset, zero bloco gravado. Esse é o pior
# desfecho possível deste módulo, pior que recusar a captação na largada.
#
# Daí a folga passar a ser proporcional ao áudio gravado (o Whisper transcreve o
# que foi capturado, então o overhead cresce junto) em vez de constante. Esperar
# demais não custa nada além de um job ocioso; esperar de menos joga fora
# crédito que já foi gasto. Na medição acima o overhead foi 0,40 × o tempo de
# gravação, e a fração abaixo dá ~25% de margem sobre isso.
FOLGA_BASE_SEG = 600
FRACAO_OVERHEAD = 0.5

# Teto da espera, alinhado ao `timeout-minutes` do step "Captar rádios" do
# radio.yml (200 min). Fica DELIBERADAMENTE abaixo dele: se o Actions matar o
# job primeiro, o processo morre sem imprimir o id do run, e aí o resgate exige
# garimpar o console da Apify. Desistindo antes, o coletor ainda registra o
# `--adotar-radio <run_id>` no log.
#
# Se este número subir, o `timeout-minutes` do step (e o do job) tem que subir
# junto — a mesma regra dos três lugares que guardam o teto de 120 min de
# duração, e pelo mesmo motivo: números que divergem fazem o job ser abortado
# no meio de uma gravação já paga.
TETO_ESPERA_SEG = 195 * 60

_DIAS_SEMANA = ("seg", "ter", "qua", "qui", "sex", "sab", "dom")


def _tz_tenant():
    """Fuso do TENANT, nunca o relógio do runner.

    O `hora_inicio` é cadastrado na hora local de Alagoinhas, mas o coletor
    rodava `datetime.now()` naive: no GitHub Actions (UTC) a janela "07:00"
    abria às 04:00 de Brasília, e nenhum cron pontual salvaria — bug latente
    achado em 03/08, mascarado porque as estações estavam sem horário
    cadastrado (e o fallback antigo capturava sempre).

    America/Bahia não tem horário de verão desde 2019, então o fallback de
    UTC-3 fixo é exato quando o banco de fusos não está disponível (Windows
    sem tzdata instalado).
    """
    nome = os.environ.get("RADAR_TZ", "America/Bahia")
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(nome)
    except Exception:
        return timezone(timedelta(hours=-3), "BRT")


def _agora_local() -> datetime:
    return datetime.now(_tz_tenant())


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


def _programas_de(config: dict | None) -> list[dict]:
    """A grade de programas da estação, no formato novo ou no legado.

    Formato novo (03/08): `config.programas` é uma LISTA de
    `{nome, hora_inicio, duracao_min, dias}` — uma mesma rádio tem vários
    programas em horários diferentes, e cada um é uma janela de captação
    própria. Formato legado: os mesmos campos soltos na raiz do config
    (`programa`/`hora_inicio`/...), que valem como grade de um programa só.
    Programa sem `hora_inicio` parseável é descartado aqui: sem horário não há
    janela, e a captação automática é só por janela (regra de 03/08).
    """
    cfg = config or {}
    brutos = cfg.get("programas")
    if not isinstance(brutos, list):
        brutos = [{
            "nome": cfg.get("programa"),
            "hora_inicio": cfg.get("hora_inicio"),
            "duracao_min": cfg.get("duracao_min"),
            "dias": cfg.get("dias"),
        }]
    validos = []
    for p in brutos:
        if not isinstance(p, dict):
            continue
        if _hhmm_para_minutos(p.get("hora_inicio") or "") is None:
            continue
        validos.append({
            "nome": (p.get("nome") or "").strip() or None,
            "hora_inicio": p.get("hora_inicio"),
            "duracao_min": p.get("duracao_min"),
            "dias": p.get("dias") or [],
        })
    return validos


def _programa_roda_hoje(prog: dict, agora: datetime) -> bool:
    dias = prog.get("dias") or []
    if not dias:
        return True
    hoje = _DIAS_SEMANA[agora.weekday()]
    return hoje in [str(d).strip().lower()[:3] for d in dias]


def programa_no_ar(config: dict | None, agora: datetime) -> dict | None:
    """O programa cuja janela de INÍCIO está aberta agora, ou None.

    A janela vai de hora_inicio até hora_inicio + TOLERANCIA_MIN: é o momento
    de COMEÇAR a gravar, não a duração da gravação — a captura em si se
    estende por duracao_min depois disso. Com grade múltipla, cada programa é
    uma janela independente; o primeiro que casar decide (grades sensatas não
    têm dois programas abrindo no mesmo instante).
    """
    atual = agora.hour * 60 + agora.minute
    for p in _programas_de(config):
        if not _programa_roda_hoje(p, agora):
            continue
        inicio = _hhmm_para_minutos(p["hora_inicio"])
        if inicio is not None and inicio <= atual <= inicio + TOLERANCIA_MIN:
            return p
    return None


def dentro_da_janela(config: dict | None, agora: datetime) -> tuple[bool, str]:
    """Decide se AGORA é hora de capturar esta estação. Devolve (pode, motivo).

    Estação sem NENHUM programa com horário cadastrado NÃO entra na captação
    automática — só grava sob demanda (botão GRAVAR do painel, que passa por
    `somente_ids` e nem consulta esta função). A regra do produto é gravar
    apenas no horário pré-determinado ou quando alguém pede: capturar "a cada
    execução" por omissão de cadastro gravaria a grade musical, que é o
    material que o portão de relevância existe para não pagar. O motivo
    devolvido aparece no log, então a estação não fica muda sem explicação.
    """
    programas = _programas_de(config)
    if not programas:
        return False, ("sem programa com horario cadastrado — cadastre a grade "
                       "ou use o botao GRAVAR do painel")

    prog = programa_no_ar(config, agora)
    if prog:
        rotulo = prog.get("nome") or prog["hora_inicio"]
        return True, f"dentro da janela de {rotulo} ({prog['hora_inicio']} +{TOLERANCIA_MIN}min)"

    grade = ", ".join(p["hora_inicio"] for p in programas)
    return False, f"fora das janelas da grade [{grade}] (agora {agora:%H:%M})"


def minutos_ate_abrir(config: dict | None, agora: datetime) -> int | None:
    """Minutos até a PRÓXIMA janela desta estação abrir hoje. Existe por causa
    do atraso crônico do cron do GitHub (medido em 03/08: +1h52 a +2h55 nos
    três últimos agendamentos): o radio.yml passou a disparar ANTES do programa
    e o coletor espera a janela abrir, em vez de exigir que o agendador acerte
    um alvo de 20 minutos que ele comprovadamente não acerta.

    Devolve 0 se alguma janela já está aberta, None quando não há o que
    esperar hoje (nenhum programa com horário, dia fora da grade, ou todas as
    janelas de hoje já passadas — esperar o programa de AMANHÃ seria um job de
    20h, não uma espera). Com grade múltipla vale a janela MAIS PRÓXIMA.
    """
    atual = agora.hour * 60 + agora.minute
    faltas = []
    for p in _programas_de(config):
        if not _programa_roda_hoje(p, agora):
            continue
        inicio = _hhmm_para_minutos(p["hora_inicio"])
        if inicio is None or atual > inicio + TOLERANCIA_MIN:
            continue
        faltas.append(max(0, inicio - atual))
    return min(faltas) if faltas else None


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

    # Nome do programa: o que estava NO AR quando a captura começou. A fonte
    # traz `_no_ar` quando a captação veio da janela; no resgate (adotar_run)
    # ele é derivado do próprio horário do bloco; o legado (config.programa)
    # fica de último, para linha antiga continuar igual.
    no_ar = (fonte or {}).get("_no_ar")
    if not no_ar:
        try:
            dt_local = datetime.fromisoformat(inicio).astimezone(_tz_tenant())
            no_ar = programa_no_ar(cfg, dt_local)
        except ValueError:
            no_ar = None
    programa = (no_ar or {}).get("nome") or cfg.get("programa")

    return {
        "tenant":               _tenant(),
        "source_id":            (fonte or {}).get("id"),
        "estacao":              estacao,
        "programa":             programa,
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


def _fontes_todas() -> list[dict]:
    """Cadastro inteiro de rádios, ativas ou não.

    Usado só pelo resgate de um run já pago (`adotar_run`): o bloco a recuperar
    pode ser de uma estação pausada depois da captação, e nesse caso o áudio
    existe e foi cobrado — filtrar por `active` aqui descartaria de novo o que
    já se perdeu uma vez.
    """
    return _supabase_get(
        "sources", "platform=eq.radio&select=id,handle,label,config")


def _fontes_por_id(ids: list[str]) -> list[dict]:
    """Rádios do cadastro pelos ids pedidos, ATIVAS OU NÃO.

    Só a gravação sob demanda usa isto (botão GRAVAR do painel). A captação
    automática continua lendo `_fontes_ativas`: pausar uma estação tem que
    seguir tirando ela do horário do programa.
    """
    limpos = [str(i).strip() for i in ids if str(i).strip()]
    if not limpos:
        return []
    lista = ",".join(limpos)
    return _supabase_get(
        "sources",
        f"platform=eq.radio&id=in.({lista})&select=id,handle,label,config",
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
    duração entre os programas NO AR das estações da janela (`_no_ar`, posto
    pelo filtro de coletar_e_gravar): gravar além do fim do programa mais
    curto captaria a grade musical seguinte, e é mais barato. Com grade
    múltipla a duração é a do programa que abriu a janela, não a de outro
    horário da mesma rádio; o config raiz fica de fallback para o legado."""
    duracoes = []
    for f in fontes:
        prog = f.get("_no_ar") or {}
        try:
            d = int(prog.get("duracao_min")
                    or ((f.get("config") or {}).get("duracao_min")) or 0)
        except (TypeError, ValueError):
            d = 0
        if d > 0:
            duracoes.append(d)
    return min(duracoes) if duracoes else DURACAO_MIN_DEFAULT


def _timeout_da_espera(n_estacoes: int, duracao_min: int) -> int:
    """Quanto esperar pelo run da Apify, em segundos.

    Duas coisas que a folga fixa anterior ignorava:

    1. `concurrency` tem teto de 4 (MAX_CONCURRENCY). Com mais de 4 estações o
       ator grava em LOTES, e o run dura `duracao × nº de lotes` — não `duracao`.
       Com 8 estações cadastradas a espera antiga terminaria antes mesmo de a
       segunda leva começar a transcrever.
    2. O overhead de transcrição cresce com o tamanho do áudio, não é constante
       (ver FRACAO_OVERHEAD).
    """
    lotes = math.ceil(max(1, n_estacoes) / MAX_CONCURRENCY)
    gravacao_seg = max(1, duracao_min) * 60 * lotes
    pedido = int(gravacao_seg * (1 + FRACAO_OVERHEAD)) + FOLGA_BASE_SEG
    if pedido > TETO_ESPERA_SEG:
        # Acontece com muitas estações em captação longa (ex.: 8 × 120 min
        # pediria mais de 6 h, além do teto de job do próprio GitHub). Avisar
        # alto: aqui a captação provavelmente SERÁ perdida, e quem estiver
        # lendo o log precisa saber que o resgate pelo run_id é esperado, não
        # um imprevisto.
        _log(f"    ⚠ espera calculada ({pedido // 60} min) passa do teto de "
             f"{TETO_ESPERA_SEG // 60} min — o run pode terminar depois da "
             "desistencia; use --adotar-radio para recuperar")
        return TETO_ESPERA_SEG
    return pedido


def _processar_brutos(
    brutos: list,
    run_id: str,
    fonte_por_nome: dict,
    fontes: list[dict],
    dry_run: bool,
) -> dict:
    """Normaliza e grava os blocos de um run que já terminou.

    Separado de `coletar_e_gravar` para que `adotar_run` possa reaproveitar
    exatamente este caminho: um run pago cujo resultado se perdeu (timeout,
    job abortado) não deve depender de uma segunda implementação para ser
    recuperado — seria a chance de o resgate divergir da produção justamente
    no dia em que ele importa.
    """
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
        return {"fontes": len(fontes), "blocos": len(linhas), "skipped": False,
                "dry_run": True}

    n = _supabase_upsert("radio_transcripts", linhas, "tenant,estacao,inicio_ts")
    _log(f"    Gravados: {n} bloco(s) ({falhas} com falha de captura)")
    for f in fontes:
        nome = (f.get("label") or f.get("handle") or "").strip()
        desta = [l for l in linhas if l["estacao"] == nome]
        ok = any(l["status"] == "SUCCESS" for l in desta)
        _log_collection(f.get("id"), len(desta),
                        "ok" if ok else ("erro" if desta else "vazio"), dry_run)

    return {"fontes": len(fontes), "blocos": n, "falhas": falhas, "skipped": False}


def adotar_run(run_id: str, dry_run: bool = False) -> dict:
    """Grava o resultado de um run da Apify que JÁ terminou.

    Existe porque a captação é paga em tempo real: quando o coletor desiste
    antes da hora (timeout curto, job abortado pelo Actions), o crédito já foi
    gasto e a transcrição fica pronta no dataset, sem ninguém para lê-la. Isso
    é recuperável enquanto o dado existir na Apify — a retenção do plano é de
    3 dias, a mesma janela que limita o recorte dos clipes de áudio.

    Enxerga o cadastro inteiro, e não só as estações na janela horária: o run
    a resgatar pode ser de outro horário, e recusá-lo por isso descartaria de
    novo o que já foi pago.
    """
    if not _apify_token():
        _log("[radio] APIFY_API_TOKEN ausente — nao da para adotar o run")
        return {"fontes": 0, "blocos": 0, "skipped": True}

    url = f"{APIFY_BASE}/actor-runs/{run_id}"
    try:
        r = requests.get(url, params={"token": _apify_token()}, timeout=30)
        if r.status_code != 200:
            _log(f"[radio] Run {run_id}: HTTP {r.status_code} — {r.text[:160]}")
            return {"fontes": 0, "blocos": 0, "skipped": True}
        data = r.json().get("data", {})
    except Exception as e:
        _log(f"[radio] Erro ao consultar run {run_id}: {e}")
        return {"fontes": 0, "blocos": 0, "skipped": True}

    status = data.get("status")
    if status != "SUCCEEDED":
        _log(f"[radio] Run {run_id} esta {status} — so run SUCCEEDED tem dataset a adotar")
        return {"fontes": 0, "blocos": 0, "skipped": True}

    fontes = _fontes_todas()
    fonte_por_nome = {(f.get("label") or f.get("handle") or "").strip(): f
                      for f in fontes}
    brutos = _apify_buscar_resultados(data.get("defaultDatasetId"))
    _log(f"=== Adotando run {run_id} — {len(brutos)} bloco(s) bruto(s)"
         f"{' [DRY-RUN]' if dry_run else ''} ===")
    if not brutos:
        _log("    Dataset vazio ou fora da retencao (3 dias) — nada a recuperar")
        return {"fontes": len(fontes), "blocos": 0, "skipped": True}
    return _processar_brutos(brutos, run_id, fonte_por_nome, fontes, dry_run)


def _ja_captada_na_janela(fonte: dict, prog: dict, agora: datetime) -> bool:
    """True se a estação já tem bloco captado NESTA janela de programa, hoje.

    É a trava que permite ao radio.yml ter vários crons escalonados sem pagar
    duas capturas: o primeiro run que entrar na janela grava, e os demais saem
    aqui em segundos. O UNIQUE do banco impede linha duplicada, mas só DEPOIS
    de o crédito da Apify já ter sido gasto — a trava tem que vir antes.

    O recorte é POR JANELA, não por dia: com a grade múltipla (03/08), a
    captura do programa da manhã não pode bloquear o da tarde na mesma rádio.
    A folga de 10 min antes do início absorve relógio de runner e o instante
    `recordedAt` do ator, que fica a segundos do pedido.
    """
    sid = fonte.get("id")
    inicio = _hhmm_para_minutos((prog or {}).get("hora_inicio") or "")
    if not sid or inicio is None:
        return False
    abre = agora.replace(hour=inicio // 60, minute=inicio % 60,
                         second=0, microsecond=0)
    de = abre - timedelta(minutes=10)
    ate = abre + timedelta(minutes=TOLERANCIA_MIN + 10)
    linhas = _supabase_get(
        "radio_transcripts",
        f"source_id=eq.{sid}&inicio_ts=gte.{de.isoformat()}"
        f"&inicio_ts=lte.{ate.isoformat()}&select=id&limit=1",
    )
    return bool(linhas)


def coletar_e_gravar(
    dry_run: bool = False,
    ignorar_janela: bool = False,
    somente_ids: list[str] | None = None,
    duracao_min: int | None = None,
    aguardar_min: int = 0,
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

    aguardar_min: quanto tempo (minutos) o run pode DORMIR esperando a janela
    de algum programa abrir. É a resposta ao atraso crônico do cron do GitHub
    (ver minutos_ate_abrir): o workflow dispara antes do horário e espera aqui.
    Zero mantém o comportamento antigo (decide só com o relógio de agora).
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

    if somente_ids:
        # Gravação sob demanda enxerga o CADASTRO inteiro, não só as ativas:
        # `active` governa a captação automática no horário do programa, e
        # recusar uma estação cadastrada porque ela está pausada seria dizer
        # não a um pedido explícito de gravar agora.
        fontes = _fontes_por_id(somente_ids)
        if not fontes:
            _log(f"[radio] Nenhuma das {len(somente_ids)} estacao(oes) pedidas existe no cadastro")
            return {"fontes": 0, "blocos": 0, "skipped": True}
    else:
        fontes = _fontes_ativas()
    if not fontes:
        _log("[radio] Nenhuma radio ativa — nada a coletar (sistema inerte)")
        return {"fontes": 0, "blocos": 0, "skipped": True}

    # Hora LOCAL do tenant, nunca o relógio do runner (ver _tz_tenant).
    agora = _agora_local()

    # Run que chegou cedo espera a janela abrir (o cron do GitHub atrasa horas;
    # disparar antes e dormir aqui é o único jeito de começar a gravar na hora
    # certa do programa). A espera acontece ANTES do filtro, uma vez só.
    if not ignorar_janela and aguardar_min > 0:
        aberturas = [m for f in fontes
                     if (m := minutos_ate_abrir(f.get("config"), agora)) is not None]
        proxima = min(aberturas) if aberturas else None
        if proxima and 0 < proxima <= aguardar_min:
            _log(f"[radio] janela mais proxima abre em {proxima} min "
                 f"({agora:%H:%M} local) — aguardando para gravar na hora do programa")
            time.sleep(proxima * 60 + 15)
            agora = _agora_local()

    na_janela = []
    for f in fontes:
        if ignorar_janela:
            na_janela.append(f)
            continue
        pode, motivo = dentro_da_janela(f.get("config"), agora)
        rotulo = f.get("label") or f.get("handle")
        if not pode:
            _log(f"  · {rotulo}: {motivo}")
            continue
        # O programa que abriu a janela viaja com a fonte: dita a duração da
        # captura e o nome gravado no bloco (grade múltipla, 03/08).
        prog = programa_no_ar(f.get("config"), agora)
        # Trava anti-captura-dupla: com varios crons escalonados no radio.yml,
        # so o primeiro run que entra na janela paga a gravacao desta janela.
        if prog and _ja_captada_na_janela(f, prog, agora):
            _log(f"  · {rotulo}: janela de {prog.get('nome') or prog['hora_inicio']} "
                 "ja captada — outro run chegou primeiro")
            continue
        f["_no_ar"] = prog
        na_janela.append(f)
    if not na_janela:
        _log(f"[radio] {len(fontes)} radio(s) ativa(s), nenhuma na janela de captura agora")
        return {"fontes": len(fontes), "blocos": 0, "skipped": True}

    # Duração pedida no painel vence a do cadastro. Teto de 120 min (30/07):
    # cada minuto de captura é um minuto pago de run na Apify, porque o ator
    # grava em TEMPO REAL. O teto tem que caber no timeout do step do radio.yml
    # (130 min) — se um dia ele subir aqui sem subir lá, o job seria abortado no
    # meio e a captação inteira viraria crédito gasto sem transcrição nenhuma.
    duracao = max(1, min(120, int(duracao_min))) if duracao_min else _duracao_da_janela(na_janela)
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

    timeout = _timeout_da_espera(len(radios_input), duracao)
    _log(f"    Run {run_id} iniciado — aguardando ate {timeout // 60} min "
         "(a gravacao acontece em tempo real)")
    dataset_id = _apify_aguardar_run(run_id, timeout=timeout)
    if not dataset_id:
        # A desistência não descarta o run: ele pode terminar depois, e o
        # crédito já foi gasto. Registrar o id aqui é o que torna o resgate
        # possível — sem ele, achar o run exige garimpar o console da Apify.
        _log(f"    Para recuperar quando o run terminar (retencao de 3 dias na "
             f"Apify): python agora.py --adotar-radio {run_id}")
    brutos = _apify_buscar_resultados(dataset_id) if dataset_id else []
    _log(f"    {len(brutos)} bloco(s) bruto(s)")

    if dry_run and brutos:
        _log(f"    [DRY-RUN] chaves do 1º bloco cru: {sorted(brutos[0].keys())}")

    return _processar_brutos(brutos, run_id, fonte_por_nome, na_janela, dry_run)


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

    # Sem config ou sem hora_inicio: NÃO entra na captação automática. A regra
    # do produto é gravar só no horário pré-determinado ou sob demanda (botão
    # GRAVAR, que passa por somente_ids e nem consulta esta função).
    assert dentro_da_janela(None, seg_8h)[0] is False
    assert dentro_da_janela({}, seg_8h)[0] is False
    assert dentro_da_janela({"dias": ["seg"]}, seg_8h)[0] is False
    # O motivo aponta o caminho (cadastrar horário ou gravar sob demanda).
    assert "GRAVAR" in dentro_da_janela({}, seg_8h)[1]

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

    # Espera pela janela: quanto falta para o programa de hoje abrir.
    cfg8 = {"hora_inicio": "08:00", "dias": ["seg", "ter", "qua", "qui", "sex"]}
    assert minutos_ate_abrir(cfg8, seg_8h - timedelta(minutes=90)) == 90
    assert minutos_ate_abrir(cfg8, seg_8h) == 0
    # Dentro da tolerância a janela conta como aberta (0), não como perdida.
    assert minutos_ate_abrir(cfg8, seg_8h + timedelta(minutes=15)) == 0
    # Janela de hoje já passou: não há o que esperar (amanhã é outro run).
    assert minutos_ate_abrir(cfg8, seg_8h + timedelta(minutes=40)) is None
    # Dia fora da grade e cadastro sem horário: nada a esperar.
    assert minutos_ate_abrir(cfg8, dom_8h) is None
    assert minutos_ate_abrir({}, seg_8h) is None
    assert minutos_ate_abrir(None, seg_8h) is None

    # Grade MÚLTIPLA (03/08): vários programas na mesma rádio, cada um com a
    # sua janela. O formato legado (campos na raiz) vira grade de um item.
    grade = {"programas": [
        {"nome": "Manhã Total", "hora_inicio": "08:00", "duracao_min": 60,
         "dias": ["seg", "ter", "qua", "qui", "sex"]},
        {"nome": "Tarde Livre", "hora_inicio": "14:00", "duracao_min": 30},
        {"hora_inicio": "7h30"},  # inválido: descartado por não parsear
    ]}
    assert len(_programas_de(grade)) == 2
    assert len(_programas_de({"programa": "Único", "hora_inicio": "09:00"})) == 1
    assert _programas_de({"programa": "Sem hora"}) == []
    # Cada janela abre no seu horário, e o programa certo é identificado.
    assert dentro_da_janela(grade, seg_8h)[0] is True
    assert programa_no_ar(grade, seg_8h)["nome"] == "Manhã Total"
    tarde = seg_8h.replace(hour=14, minute=5)
    assert dentro_da_janela(grade, tarde)[0] is True
    assert programa_no_ar(grade, tarde)["nome"] == "Tarde Livre"
    assert dentro_da_janela(grade, seg_8h.replace(hour=11))[0] is False
    # Domingo: o da manhã tem grade seg-sex, o da tarde roda todo dia.
    assert programa_no_ar(grade, dom_8h) is None
    assert programa_no_ar(grade, dom_8h.replace(hour=14)) is not None
    # A espera mira a janela MAIS PRÓXIMA de hoje; passada a da manhã, a
    # próxima é a da tarde (e não None, como seria na grade de um programa).
    assert minutos_ate_abrir(grade, seg_8h - timedelta(minutes=60)) == 60
    assert minutos_ate_abrir(grade, seg_8h.replace(hour=8, minute=30)) == 330
    assert minutos_ate_abrir(grade, seg_8h.replace(hour=14, minute=40)) is None
    # A duração da captura é a do programa NO AR, não a de outro horário.
    assert _duracao_da_janela([{"_no_ar": {"duracao_min": 30}, "config": grade}]) == 30
    assert _duracao_da_janela([{"config": {"duracao_min": 45}}]) == 45

    # Fuso do tenant: America/Bahia é UTC-3 o ano inteiro (sem horário de
    # verão desde 2019), e o fallback fixo tem que dar o mesmo resultado.
    _agora_tz = datetime.now(_tz_tenant())
    assert _agora_tz.utcoffset() == timedelta(hours=-3)

    # Duração da janela: a menor cadastrada manda; sem cadastro, o default.
    assert _duracao_da_janela([{"config": {"duracao_min": 60}},
                               {"config": {"duracao_min": 25}}]) == 25
    assert _duracao_da_janela([{"config": {}}]) == DURACAO_MIN_DEFAULT
    assert _duracao_da_janela([{"config": {"duracao_min": "abc"}}]) == DURACAO_MIN_DEFAULT

    # Espera pelo run: o caso real que quebrou em 31/07 (4 estações × 30 min)
    # levou 2511 s e a espera antiga era de 2400 s. A nova tem que cobrir isso.
    assert _timeout_da_espera(4, 30) > 2511
    # Uma estação a mais que o teto de concorrência vira DOIS lotes, e o run
    # passa a durar duas capturas — a espera precisa dobrar junto.
    assert _timeout_da_espera(5, 30) > 2 * 30 * 60
    assert _timeout_da_espera(5, 30) > _timeout_da_espera(4, 30)
    # Dentro do mesmo lote, mais estações não alongam o run (gravam em paralelo).
    assert _timeout_da_espera(1, 30) == _timeout_da_espera(4, 30)
    # Cresce com a duração, e nunca é menor que o tempo de gravação.
    assert _timeout_da_espera(1, 120) > _timeout_da_espera(1, 30)
    assert _timeout_da_espera(1, 120) > 120 * 60
    # Zero estação não pode virar timeout negativo nem divisão por zero.
    assert _timeout_da_espera(0, 30) > 0
    # O teto vale mesmo no pior caso, senão o coletor esperaria além do job.
    assert _timeout_da_espera(8, 120) == TETO_ESPERA_SEG

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

    def _valor_de(flag: str) -> str | None:
        if flag in sys.argv:
            i = sys.argv.index(flag)
            if i + 1 < len(sys.argv):
                return sys.argv[i + 1]
        return None

    _ag = _valor_de("--aguardar")
    coletar_e_gravar(dry_run="--dry-run" in sys.argv or "--dry" in sys.argv,
                     ignorar_janela="--agora" in sys.argv,
                     aguardar_min=int(_ag) if (_ag or "").isdigit() else 0)
