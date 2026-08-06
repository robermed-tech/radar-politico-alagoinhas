"""
+==============================================================+
|  AGORA - Agente de Monitoramento Politico                     |
|  Radar Politico Alagoinhas                                    |
|                                                               |
|  Pipeline:                                                    |
|    Apify -> Comentarios -> Memoria -> Claude Haiku             |
|    -> Supabase -> WhatsApp                                    |
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
from boletim import gerar_boletim

try:
    import coletor_instagram as _ig
    _INSTAGRAPI_OK = _ig.disponivel()
except Exception:
    _INSTAGRAPI_OK = False

# Alerta de suporte (WhatsApp/SMS pro numero que o admin cadastrar em
# Configuracoes). So le env em tempo de CHAMADA (nunca em constante de
# modulo) -- ver o cabecalho de alerta_suporte.py para o motivo.
try:
    import alerta_suporte as _alerta
    _ALERTA_SUPORTE_OK = True
except Exception:
    _ALERTA_SUPORTE_OK = False

# Coletor YouTube (subsistema novo multi-plataforma). Fica inerte enquanto não
# houver fonte YouTube ativa na tabela `sources` — ver coletor_youtube.py.
try:
    import coletor_youtube as _yt
    _YOUTUBE_OK = True
except Exception:
    _YOUTUBE_OK = False

# Escuta do Radio: coleta/transcricao via Apify e analise das pautas. Tambem
# fica inerte enquanto nao houver radio ativa em `sources` — ver
# coletor_radio.py, radio_analise.py e RADAR_ESCUTA_RADIO.md.
try:
    import coletor_radio as _radio
    import radio_analise as _radio_an
    _RADIO_OK = True
except Exception:
    _RADIO_OK = False
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

# Aliases de bairro que TAMBEM sao substantivo comum do portugues. Para eles,
# "o valor contem essa palavra" nao prova nada sobre lugar: "centro" aparece em
# "Centro de Testagem e Aconselhamento", "centro de saude", "centro cirurgico";
# "cruzeiro" em "Cruzeiro do Sul"; "riacho" em qualquer riacho do municipio.
#
# A lista e de palavras, nao de bairros: ela e cruzada com os aliases reais de
# cada tenant em tempo de execucao, entao serve para qualquer cidade cujo bairro
# se chame Centro, Alto, Parque, Vila e afins.
_PALAVRA_COMUM_DE_LUGAR = {
    "centro", "cruzeiro", "velha", "velho", "riacho", "roca", "barreiro",
    "jardim", "parque", "praca", "alto", "vila", "morro", "campo", "ponte",
    "lagoa", "rio", "feira", "porto", "ilha", "estacao", "mata", "serra",
    "varzea", "poco", "fonte", "pedreira", "olaria", "matadouro",
}

# Palavras que, depois de um alias generico, MANTEM o sentido de lugar:
# "centro da CIDADE", "centro de ALAGOINHAS". O nome do tenant entra em tempo
# de execucao. Qualquer outra continuacao ("centro de testagem") descarta.
_MARCADOR_DE_LUGAR = {"cidade", "bairro", "povoado", "distrito", "vila", "municipio"}

_LIGACAO_DE_LUGAR = re.compile(r"^(?:de|da|do|dos|das)\s+(\w+)")

# Palavra que, ANTES de um bairro com nome de santo, indica a festa ou a igreja
# e nao o lugar: "nossa alvorada santa Terezinha esta de parabens" fala do
# festejo, nao do bairro. Alagoinhas tem Santa Terezinha e Santa Isabel, entao
# a confusao e estrutural, nao um caso isolado.
_CONTEXTO_DE_FESTA = {
    "alvorada", "festa", "festejo", "festejos", "igreja", "paroquia",
    "padroeira", "missa", "novena", "procissao", "capela", "santuario",
    "quermesse", "arraia", "arraial",
}

# Alias de UMA palavra que tambem e nome de municipio vizinho. "Ate Catu
# colocou umas atracoes de peso" compara Alagoinhas com a CIDADE de Catu, nao
# com a rua do Catu daqui. Como o apelido especifico ("rua do catu") existe na
# tabela, exigir prova de lugar do apelido curto nao custa capturas boas.
_ALIAS_DE_MUNICIPIO_VIZINHO = {"catu"}


def _contexto_de_festa(texto_norm: str, pos_inicio: int) -> bool:
    """As duas palavras antes do alias indicam festa/igreja em vez de bairro?"""
    anteriores = texto_norm[:pos_inicio].split()[-2:]
    return any(p.strip(".,;:!?()") in _CONTEXTO_DE_FESTA for p in anteriores)


def _alias_extensivel(alias_norm: str) -> bool:
    """O alias termina numa palavra comum, e por isso pode ser so o comeco de
    outro nome?

    Olha a ULTIMA palavra, e nao o alias inteiro. Foi o buraco da primeira
    versao: "no centro" tem duas palavras, entao nao estava na lista de
    genericos e voltava a casar dentro de "no centro de cirurgias eletivas" e
    "no Centro Administrativo" — a contaminacao do CTA por outra porta.

    "centro da cidade" e "riacho da guia" terminam em palavra distintiva
    (cidade, guia) e seguem valendo por conteudo, como deve ser.
    """
    ultima = (alias_norm or "").split()[-1:] or [""]
    if ultima[0] in _PALAVRA_COMUM_DE_LUGAR:
        return True
    # Apelido de uma palavra so que colide com municipio vizinho tambem precisa
    # de prova de lugar: "Ate Catu colocou" e a cidade, nao a rua do Catu.
    return alias_norm in _ALIAS_DE_MUNICIPIO_VIZINHO


def _generico_e_lugar(valor_norm: str, alias_norm: str, tenant: str) -> bool:
    """O alias generico aparece como LUGAR, ou como cabeca de outro nome?

    Vale para o valor CURTO que o modelo extrai no campo `localidade`, nao para
    texto corrido (ver _so_em_composto, usado pelo reparo). Aceita quando o
    alias termina a frase, quando e seguido de pontuacao, ou quando e seguido
    de marcador de lugar. Recusa "centro de testagem": foi o caso que
    contaminou o Mapa da Cidade, com quatro denuncias sobre o CTA virando
    quatro criticas ao bairro Centro, que de verdade tinha duas mencoes.

    Nao existe aqui um resgate por preposicao anterior ("no centro..."). Chegou
    a existir, e abria justamente o buraco que a regra fecha: em "no centro de
    cirurgias eletivas" a preposicao aprovava a linha antes de alguem olhar o
    que vinha depois. Como a entrada e o valor curto extraido, "no Riacho" ja
    passa pelo fim-de-frase e o resgate nao fazia falta.
    """
    m = _padrao(alias_norm).search(valor_norm)
    if not m:
        return False
    depois = valor_norm[m.end():].strip()
    if not depois:
        return True
    if depois[0] in ",.;:!?)]}/|":
        return True
    lig = _LIGACAO_DE_LUGAR.match(depois)
    if lig:
        return lig.group(1) in (_MARCADOR_DE_LUGAR | {_norm(tenant)})
    # Qualquer outra palavra colada ("centro cirurgico", "centro esportivo")
    # transforma o alias em cabeca de um nome que nao e o bairro.
    return False


def _so_em_composto(texto_norm: str, alias_norm: str, tenant: str) -> bool:
    """TODA ocorrencia do alias no texto e cabeca de um nome composto?

    Regra do REPARO, deliberadamente mais conservadora que a do normalizador.
    Aqui a entrada e texto corrido, onde a palavra aparece cercada de verbo e
    virgula ("Barreiro estao so as crateras", "no Riacho esse ano"): exigir a
    mesma prova de lugar do normalizador marcaria bairro legitimo como erro.
    Foi o que aconteceu na primeira tentativa, com 3 falsos positivos em 7.

    So devolve True quando o alias APARECE e todas as suas ocorrencias sao do
    tipo "centro de testagem". Texto que nao cita a palavra devolve False: o
    modelo pode ter usado outra pista (em "era Riachense" ele acertou Riacho da
    Guia sem escrever "riacho"), e adivinhar contra ele apagaria dado bom.
    """
    achou = False
    for m in _padrao(alias_norm).finditer(texto_norm):
        achou = True
        lig = _LIGACAO_DE_LUGAR.match(texto_norm[m.end():].strip())
        composto = bool(lig) and lig.group(1) not in (_MARCADOR_DE_LUGAR | {_norm(tenant)})
        if not composto:
            return False
    return achou


def normalizar_localidade(valor: str, mapa_bairros: dict, tenant: str = None) -> str:
    """
    Sempre devolve slug valido de public.bairros, ou 'nao_identificado'.
    Nunca texto livre. Nunca levanta excecao.

    Ordem de resolucao: match exato do slug/alias -> match por palavra inteira,
    do alias MAIS LONGO para o mais curto -> 'nao_identificado'.

    Duas regras existem por causa da contaminacao achada em 27/07:

    1. Alias mais longo primeiro. Antes a varredura seguia a ordem de insercao
       do dicionario, entao "centro" podia vencer "centro da cidade" e "riacho"
       podia vencer "riacho da guia" — o apelido curto decidindo no lugar do
       nome completo.
    2. Alias que e substantivo comum (ver _PALAVRA_COMUM_DE_LUGAR) precisa
       aparecer como LUGAR, nao como primeira palavra de outro nome.
    """
    try:
        if not valor or not mapa_bairros:
            return "nao_identificado"
        v = _norm(valor)
        if v in mapa_bairros:
            return mapa_bairros[v]
        # A ordenacao mora aqui, e nao em carregar_bairros, para que nenhum
        # chamador consiga quebrar a regra montando o mapa por conta propria.
        for alias_norm, slug in sorted(mapa_bairros.items(), key=lambda kv: -len(kv[0] or "")):
            if not alias_norm or not _tem_termo(v, alias_norm):
                continue
            if _alias_extensivel(alias_norm) and not _generico_e_lugar(
                v, alias_norm, tenant or TENANT
            ):
                continue
            return slug
    except Exception:
        pass
    return "nao_identificado"

# ==============================================================
# CONFIGURACAO
# ==============================================================

APIFY_TOKEN      = os.environ.get("APIFY_API_TOKEN", "")
ANTHROPIC_KEY    = os.environ["ANTHROPIC_API_KEY"]
EVOLUTION_URL    = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_KEY    = os.environ.get("EVOLUTION_API_KEY", "")
WHATSAPP_NUMBER  = os.environ.get("WHATSAPP_NUMBER", "")
# Supabase: fonte unica de gravacao e leitura (o Google Sheets saiu do fluxo em 01/08/2026).
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

# Vocabulario fixo de tema, usado em posts.tema/comments.tema e replicado no
# tema_categoria dos alertas do briefing estrategico (ver _gerar_briefing).
TEMAS_VALIDOS = {"saude", "educacao", "obras", "seguranca", "transporte",
                 "emprego", "impostos", "saneamento", "cultura_eventos", "comunicacao"}

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

def _carregar_perfis_do_banco(tenant_id):
    """Carrega fontes ativas de monitored_sources PARA UM TENANT. Fallback para
    _PERFIS_FALLBACK (só faz sentido como fallback do tenant 'alagoinhas' —
    para um tenant novo sem linhas em monitored_sources, o fallback ficaria
    vazio na prática, o que é o comportamento correto: sem fonte configurada,
    sem coleta, em vez de herdar os perfis de outro cliente).
    Antes desta função filtrava só por platform+active, sem tenant_id — com
    2+ tenants usando a mesma tabela monitored_sources isso misturaria
    perfis de clientes diferentes num único dict."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return _PERFIS_FALLBACK if tenant_id == "alagoinhas" else {}
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/monitored_sources",
            params={"tenant_id": f"eq.{tenant_id}", "platform": "eq.instagram", "active": "eq.true",
                    "select": "handle,categoria,filtro"},
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=10,
        )
        if r.status_code != 200:
            return _PERFIS_FALLBACK if tenant_id == "alagoinhas" else {}
        rows = r.json()
        if not rows:
            return _PERFIS_FALLBACK if tenant_id == "alagoinhas" else {}
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
        return _PERFIS_FALLBACK if tenant_id == "alagoinhas" else {}

# PERFIS é populado por _carregar_config_tenant(TENANT), chamada mais abaixo
# depois que _carregar_keywords_do_banco/_carregar_tenant_settings existem —
# um único ponto de carga em vez de espalhado (ver _carregar_config_tenant).
PERFIS = {}

# Palavras-chave de relevancia por filtro
_KEYWORDS_FALLBACK_GOVERNO  = ["prefeitura", "prefeito", "gustavo", "gestao", "alagoinhas",
                               "obra", "servico", "municipal", "secretaria", "secom"]
_KEYWORDS_FALLBACK_OPOSICAO = ["prefeitura", "prefeito", "gustavo carmo", "gestao municipal",
                               "administracao", "gestao de alagoinhas", "prefeito de alagoinhas"]
_KEYWORDS_FALLBACK_IMPRENSA = ["prefeitura de alagoinhas", "gustavo carmo", "gestao municipal",
                               "prefeito de alagoinhas"]

def _carregar_keywords_do_banco(tenant_id):
    """Busca keywords ativas de relevance_keywords PARA UM TENANT (lista única
    para todos os filtros). Fallback por categoria se o banco estiver vazio
    ou inacessível.
    Antes desta função filtrava sempre por tenant_id='alagoinhas' fixo no
    código — um tenant novo veria as keywords de Alagoinhas em vez das
    próprias (ou nenhuma, dependendo do que estivesse cadastrado)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/relevance_keywords",
            params={"tenant_id": f"eq.{tenant_id}", "select": "keyword,active"},
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return None
        return [row["keyword"].lower() for row in r.json() if row.get("active", True)]
    except Exception:
        return None

def _carregar_tenant_settings(tenant_id):
    """Busca tenant_settings do Supabase para um tenant. Retorna dict vazio se indisponível."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/tenant_settings",
            params={"tenant_id": f"eq.{tenant_id}",
                    "select": "score_weights,climate_thresholds,notification_config"},
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return {}
        return r.json()[0]
    except Exception:
        return {}

# Score de alerta
SCORE_IMAGEM_ALERTA = 30
SCORE_RISCO_ALERTA  = 70

# Override SCCT criterioso — alerta crises intencionais de alta responsabilidade
# mesmo quando o score nao atinge 70 (posts de oposicao eficazes ficam em ~62).
OVERRIDE_ALERTA_ATIVO         = True
OVERRIDE_SCORE_MIN            = 55
OVERRIDE_EXIGE_TRACAO         = True

def _carregar_config_tenant(tenant_id):
    """Ponto único de carga de config por tenant: perfis monitorados, keywords
    de relevância e tenant_settings (limiares de clima/notificação). Rebind
    dos globais correspondentes via `global` — mesmo padrão já usado para
    TENANT/PERFIS em main_multi_tenant(), agora estendido para tudo que era
    lido só 1x na carga do módulo.
    Chamada na carga do módulo (tenant único, via RADAR_TENANT) e de novo a
    cada iteração de main_multi_tenant(): sem isso, o 2º+ tenant do loop
    herdava silenciosamente as keywords/limiares carregados para o 1º —
    bug nunca exercitado porque só existe 1 tenant em produção até hoje."""
    global PERFIS, KEYWORDS_GOVERNO, KEYWORDS_OPOSICAO, KEYWORDS_IMPRENSA
    global _TENANT_SETTINGS, _ct, _nc
    global OVERRIDE_RESPONSABILIDADE_MIN, _LIMIAR_PREVISAO, _LIMIAR_TEMPESTADE_COM_ALERTA
    global SUBTEMA_LIMIAR_ALERTA, SUBTEMA_ALERTA_ATIVO

    PERFIS = _carregar_perfis_do_banco(tenant_id)

    _TENANT_SETTINGS = _carregar_tenant_settings(tenant_id)
    _ct = _TENANT_SETTINGS.get("climate_thresholds", {})
    _nc = _TENANT_SETTINGS.get("notification_config", {})

    _keywords_banco = _carregar_keywords_do_banco(tenant_id)
    # Se o banco retornou keywords, todas as categorias usam a mesma lista.
    # Caso contrário, cada categoria usa seu fallback específico.
    KEYWORDS_GOVERNO  = _keywords_banco or _KEYWORDS_FALLBACK_GOVERNO
    KEYWORDS_OPOSICAO = _keywords_banco or _KEYWORDS_FALLBACK_OPOSICAO
    KEYWORDS_IMPRENSA = _keywords_banco or _KEYWORDS_FALLBACK_IMPRENSA
    if _keywords_banco:
        print(f"[config:{tenant_id}] {len(PERFIS)} perfis, {len(_keywords_banco)} keywords do Supabase")
    else:
        print(f"[config:{tenant_id}] {len(PERFIS)} perfis; keywords em fallback hardcoded "
              f"(governo:{len(KEYWORDS_GOVERNO)} oposicao:{len(KEYWORDS_OPOSICAO)} imprensa:{len(KEYWORDS_IMPRENSA)})")

    OVERRIDE_RESPONSABILIDADE_MIN = int(_ct.get("override_resp_min", 70))
    _LIMIAR_PREVISAO              = float(_ct.get("limiar_previsao", 8.0))
    _LIMIAR_TEMPESTADE_COM_ALERTA = float(_ct.get("limiar_tempestade_com_alerta", 60.0))

    # Alerta por volume de subtema (sensacao popular): N+ comentarios do mesmo
    # subtema em 24h dispara, independente do score do post. Default DESLIGADO —
    # e um canal de WhatsApp novo (acao externa), so liga pela aba Notificacoes.
    SUBTEMA_LIMIAR_ALERTA = int(_nc.get("subtema_limiar", 3))
    SUBTEMA_ALERTA_ATIVO  = bool(_nc.get("subtema_ativo", False))

_carregar_config_tenant(TENANT)

# Retencao de dados pessoais (LGPD) — janela em dias para o texto bruto e o @
# do autor. Opiniao politica de cidadao identificado e dado pessoal SENSIVEL
# (LGPD art. 5o, II) e o controlador aqui e orgao publico, entao "reter o
# minimo necessario" nao e boa pratica opcional, e obrigacao legal.
# Passada a janela, expurgar_pii() apaga texto e username e mantem so a
# classificacao agregada + autor_hash. Ver supabase/migrations/009.
RETENCAO_PII_DIAS = int(os.environ.get("RETENCAO_PII_DIAS", "180"))

# Retencao da transcricao bruta de radio. Mais curta que a dos comentarios de
# proposito: quem liga para a radio e se identifica no ar nunca escolheu falar
# com este sistema, a transcricao e volumosa, e o valor analitico dela ja foi
# extraido para radio_topics na primeira analise. Ver expurgar_pii_radio e a
# migration 011.
RETENCAO_RADIO_DIAS = int(os.environ.get("RETENCAO_RADIO_DIAS", "90"))

# Limites de coleta
# 5 e nao 10: a Apify cobra por item devolvido (US$ 0,0023), entao cada rodada
# pagava por ~138 publicacoes para achar ~10 novas. Medido na base em 04/08, um
# perfil publica 1x/dia na mediana, 3 no p90 e 7 no pior dia registrado — com 3
# coletas diarias, as 5 ultimas de cada perfil cobrem ate o dia de pico. Subir
# de novo so faz sentido se a cadencia cair para 1 coleta/dia.
MAX_POSTS_POR_PERFIL    = 5
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

# ── Saude das chamadas a Anthropic ────────────────────────────────
# Incidente de 01/08/26: o credito da API esgotou no meio do dia, TODAS as
# chamadas ao modelo do run das 18:03 UTC falharam com HTTP 400 "credit
# balance is too low", e o pipeline gravou _DEFAULTS_ANALISE em tudo — run
# "success", painel sem analise nova, e o Alerta de Suporte mudo, porque nao
# houve excecao nao tratada nem coleta vazia (a Apify funcionou). Cada falha
# individual e engolida de proposito (um lote perdido nao pode derrubar o
# run); o que faltava era alguem OLHAR O CONJUNTO no fim. Este contador faz
# isso: toda chamada passa por _cliente_anthropic(), e _verificar_saude_
# anthropic() decide no fim do main() se o run inteiro rodou sem modelo.
_SAUDE_ANTHROPIC = {"ok": 0, "falha_credito": 0, "falha_outra": 0, "ultimo_erro": ""}

# Falhas de credito/chave por run a partir das quais o alerta dispara mesmo
# com sucessos anteriores: esse erro e deterministico (nao e 529 transitorio),
# entao 3 ocorrencias ja significam "esgotou no meio do run e nada mais passa".
_LIMIAR_FALHAS_CREDITO = 3

def _zerar_saude_anthropic():
    _SAUDE_ANTHROPIC.update(ok=0, falha_credito=0, falha_outra=0, ultimo_erro="")

def _erro_anthropic_de_credito(e):
    """Erro deterministico de conta (credito esgotado ou chave invalida), que
    vai falhar igual em toda chamada seguinte — diferente de 529/timeout, que
    e transitorio e nao justifica alerta."""
    m = str(e).lower()
    return any(p in m for p in (
        "credit balance",          # 400 "credit balance is too low"
        "insufficient credit",
        "billing",
        "invalid x-api-key",       # 401 authentication_error
        "authentication_error",
    ))

class _MessagesMonitorado:
    """Proxy fino sobre client.messages que so conta sucesso/falha — a excecao
    segue subindo para o try/except de cada chamador, exatamente como antes."""
    def __init__(self, inner):
        self._inner = inner

    def create(self, *args, **kwargs):
        try:
            r = self._inner.create(*args, **kwargs)
        except Exception as e:
            if _erro_anthropic_de_credito(e):
                _SAUDE_ANTHROPIC["falha_credito"] += 1
            else:
                _SAUDE_ANTHROPIC["falha_outra"] += 1
            _SAUDE_ANTHROPIC["ultimo_erro"] = str(e)[:400]
            raise
        _SAUDE_ANTHROPIC["ok"] += 1
        return r

class _ClienteMonitorado:
    def __init__(self, cli):
        self._cli = cli
        self.messages = _MessagesMonitorado(cli.messages)

    def __getattr__(self, nome):
        return getattr(self._cli, nome)

def _cliente_anthropic():
    """Ponto unico de criacao do cliente Anthropic. Todo call site usa esta
    funcao (nunca Anthropic() direto) para a contagem de saude enxergar o run
    inteiro — a chave continua lida em tempo de chamada, via ANTHROPIC_KEY."""
    return _ClienteMonitorado(Anthropic(api_key=ANTHROPIC_KEY))

def _verificar_saude_anthropic():
    """No fim do main(): se o run rodou com o modelo fora do ar por credito ou
    chave, avisa o admin. O run NAO passa a falhar por isso — o objetivo e
    avisar que o painel parou de receber analise nova, nao derrubar a coleta."""
    ok = _SAUDE_ANTHROPIC["ok"]
    cred = _SAUDE_ANTHROPIC["falha_credito"]
    if cred == 0:
        return
    # "Todas" (ok == 0) cobre o run pequeno; o limiar cobre o credito que
    # esgota no MEIO do run, quando as primeiras chamadas ainda passaram.
    if ok > 0 and cred < _LIMIAR_FALHAS_CREDITO:
        log(f"  [saude_anthropic] {cred} falha(s) de credito/chave com {ok} "
            "sucesso(s) — abaixo do limiar, sem alerta.")
        return
    motivo = (
        f"Anthropic: {cred} chamada(s) ao modelo falharam por credito/chave "
        f"neste run ({ok} com sucesso) — o pipeline gravou analise DEFAULT e o "
        f"painel parou de receber analise nova. Ultimo erro: "
        f"{_SAUDE_ANTHROPIC['ultimo_erro']}"
    )
    log(f"  [saude_anthropic] {motivo}")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::warning::{motivo}")
    if _ALERTA_SUPORTE_OK:
        # Dedup pela janela do alerta_historico, como os demais disparos.
        _alerta.disparar("anthropic_sem_credito", motivo)

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

# Tokens que, sozinhos, nao identificam a gestao monitorada: aparecem em
# noticia sobre QUALQUER prefeitura do Brasil. NAO sao palavras de busca — a
# lista cadastrada em relevance_keywords continua intacta. Servem apenas para
# decidir se uma keyword CADASTRADA e especifica (ja ancora no municipio) ou
# generica (precisa de ancora no texto para valer).
_TOKENS_GENERICOS = {
    "prefeito", "prefeita", "prefeitura", "gestao", "administracao", "adm",
    "municipal", "municipais", "municipio", "cidade", "governo", "publica",
    "publico", "de", "da", "do", "dos", "das", "e", "a", "o", "em", "no", "na",
}


# Confianca minima para um comentario contar como critica ou elogio no clima.
# O classificador devolve `confianca_tema` 0-100 e recebe instrucao explicita de
# usar < 50 quando nao consegue decidir a polaridade (ironia, giria, texto curto
# demais). Abaixo disso o comentario entra na conta como INDETERMINADO: soma no
# total, nao soma em nenhum dos lados. Medido em 25/07: 464 dos 1302 comentarios
# classificados como positivo/negativo tinham confianca < 70, e 79 tinham < 50.
# O espelho deste valor no frontend fica em radar-app/src/lib/sentimento.ts.
CONFIANCA_MIN_SENTIMENTO = 50


def _sentimento_confiavel(comentario) -> bool:
    """True se a classificacao de sentimento deste comentario pode contar como
    critica/elogio. `confianca_tema` ausente ou 0 vem de comentario antigo,
    anterior ao campo — nesses a confianca nao foi medida, entao mantemos o
    valor (nao da para reprovar retroativamente o que nunca foi avaliado)."""
    try:
        conf = int(comentario.get("confianca_tema") or 0)
    except (TypeError, ValueError):
        return True
    return conf == 0 or conf >= CONFIANCA_MIN_SENTIMENTO


def _contem_termo(texto: str, termo: str) -> bool:
    """Casa o termo por SUBSTRING (nao por palavra inteira), so normalizando
    acentos e caixa. Substring e proposital: no Instagram a mencao ao perfil
    oficial vem colada — '@prefeituraalagoinhas', '@gustavoascarmo' — e e
    justamente o sinal mais forte de que o post fala da gestao daqui. Exigir
    palavra inteira descartaria esses posts (testado contra a base real)."""
    return _norm(termo) in _norm(texto)


@lru_cache(maxsize=32)
def _classificar_keywords(keywords: tuple):
    """Separa as keywords cadastradas em especificas x genericas e deriva as
    ANCORAS do tenant (os tokens distintivos das especificas: 'alagoinhas',
    'gustavo', 'carmo'...).

    Tudo sai das palavras que o cliente cadastrou — nada e inventado nem
    substituido aqui.
    """
    especificas, genericas, ancoras = [], [], set()
    for kw in keywords:
        distintivos = [t for t in _norm(kw).split()
                       if t not in _TOKENS_GENERICOS and len(t) > 2]
        if distintivos:
            especificas.append(kw)
            ancoras.update(distintivos)
        else:
            genericas.append(kw)
    return tuple(especificas), tuple(genericas), frozenset(ancoras)


@lru_cache(maxsize=8)
def _ancoras_de_perfis(handles: tuple):
    """Handles dos perfis POLITICOS locais cadastrados pelo cliente na tela
    Fontes — governo e oposicao — usados como ancora do municipio.

    Por que isso e ancora legitima: sao as pessoas que ocupam ou disputam o
    poder AQUI. Uma materia que cita @gleysersoares ou @jaldicenunes esta
    falando de politica de Alagoinhas, mesmo sem escrever o nome da cidade —
    e um veiculo local raramente escreve, porque para ele isso e obvio. Foi
    esse o falso positivo que quase apagou a materia sobre os motoristas da
    COOMAP na limpeza de 25/07.

    Perfis de IMPRENSA ficam de fora de proposito: o nome de um veiculo nao
    diz de que cidade e o fato narrado. @seligaalagoinhas publica sobre
    Cardeal da Silva e Jequie, e foi justamente por isso que a ancora passou
    a ser exigida da imprensa.

    Nada e inventado aqui: a lista sai de monitored_sources, cadastrada pelo
    cliente na tela Fontes, do mesmo jeito que as ancoras de texto saem das
    keywords cadastradas na tela Relevancia.
    """
    # Handle curto casaria dentro de qualquer palavra (o match e por
    # substring): exige >= 6 caracteres para nao criar falso positivo novo.
    return frozenset(h for h in handles if len(h) >= 6)


def _ancoras_ativas(ancoras_keywords):
    """Uniao das ancoras de texto (derivadas das keywords) com os handles
    politicos cadastrados. Recalculada a cada chamada porque PERFIS e
    recarregado por tenant (ver _carregar_config_tenant)."""
    handles = tuple(sorted(
        h for h, info in PERFIS.items()
        if (info.get("filtro") or "") in ("governo", "oposicao")
    ))
    return ancoras_keywords | _ancoras_de_perfis(handles)


def _motivo_relevancia(caption, categoria_filtro):
    """Igual a filtrar_relevante, mas devolve (passou, motivo) — usado pelo
    --teste-filtro e pelos logs de depuracao."""
    if categoria_filtro == "oposicao":
        kws = KEYWORDS_OPOSICAO
    elif categoria_filtro == "imprensa":
        kws = KEYWORDS_IMPRENSA
    else:
        kws = KEYWORDS_GOVERNO

    especificas, genericas, ancoras = _classificar_keywords(tuple(kws))

    achou_esp = next((kw for kw in especificas if _contem_termo(caption, kw)), None)
    if achou_esp:
        return True, f"keyword especifica '{achou_esp}'"

    achou_gen = next((kw for kw in genericas if _contem_termo(caption, kw)), None)
    if not achou_gen:
        return False, "nenhuma keyword cadastrada encontrada"

    # A ancora so e exigida da IMPRENSA. Perfis de governo sao as contas
    # oficiais da propria gestao e os de oposicao sao politicos LOCAIS
    # cadastrados a dedo: quando escrevem "a gestao" ou "a prefeitura" estao
    # falando da gestao daqui, sem precisar repetir o nome da cidade — exigir
    # ancora deles descartaria conteudo legitimo. Ja a imprensa cobre a regiao
    # inteira e publica sobre outros municipios, que era a origem do problema.
    if categoria_filtro == "governo":
        return True, f"keyword '{achou_gen}' (conta oficial da gestao)"
    if categoria_filtro != "imprensa":
        return True, f"keyword '{achou_gen}' (perfil politico local)"

    # Ancoras = tokens das keywords especificas + handles dos perfis politicos
    # cadastrados na tela Fontes (ver _ancoras_de_perfis).
    ancoras = _ancoras_ativas(ancoras)
    if not ancoras:
        # Nenhuma keyword especifica cadastrada e nenhum perfil politico: sem
        # ancora para exigir, mantem o comportamento antigo em vez de descartar
        # tudo.
        return True, f"keyword '{achou_gen}' (tenant sem keyword especifica cadastrada)"

    achou_anc = next((a for a in sorted(ancoras) if _contem_termo(caption, a)), None)
    if achou_anc:
        return True, f"keyword generica '{achou_gen}' + ancora '{achou_anc}'"
    return False, (f"imprensa: keyword generica '{achou_gen}' sem ancora do municipio "
                   "(nem palavra do tenant, nem perfil politico cadastrado) "
                   "— noticia de outra cidade")


def filtrar_relevante(caption, categoria_filtro):
    """Decide se um post entra na base de analise.

    Revisao de 25/07 (a): uma keyword GENERICA ('prefeito', 'prefeitura',
    'gestao municipal') casa com noticia de qualquer municipio do Brasil — foi
    assim que posts sobre o prefeito de Cardeal da Silva entraram na base de
    Alagoinhas e acabaram classificados como negativos para Gustavo Carmo.
    Agora ela so vale quando o texto tambem cita uma ancora do tenant, derivada
    das proprias keywords cadastradas. Keywords especificas continuam valendo
    sozinhas. A lista cadastrada nao e alterada em nenhum momento.

    Revisao de 25/07 (b): TODO perfil cadastrado passa pelo filtro, inclusive
    os de governo. Antes a conta oficial da gestao era isenta ("a fonte ja e o
    criterio"), o que fazia entrar na base — e portanto no clima — post de
    aniversario de artista, agenda cultural sem servico e afins, sem nenhuma
    relacao com as palavras da tela Relevancia. Decisao do cliente: o clima so
    pode ser formado por conteudo que se relacione com as palavras cadastradas,
    nada alem disso. Para governo a ancora do municipio nao e exigida (a conta
    ja e da gestao daqui); exige-se apenas que alguma keyword cadastrada
    apareca no texto.

    Revisao de 25/07 (c): os handles dos perfis POLITICOS cadastrados na tela
    Fontes (governo e oposicao) tambem valem como ancora para a imprensa. Um
    veiculo local nao repete o nome da cidade — para ele isso e obvio — mas
    cita os politicos daqui. Sem isso, materia sobre cobranca a gestao que
    marcava @gleysersoares e @jaldicenunes era descartada como "noticia de
    outra cidade". Handles de IMPRENSA nao entram: o nome do veiculo nao diz
    de que cidade e o fato narrado. Ver _ancoras_de_perfis.
    """
    passou, _ = _motivo_relevancia(caption, categoria_filtro)
    return passou

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
            # Com o corpo, e não só o status: um 404 da Evolution é ambíguo
            # entre instância derrubada e número sem WhatsApp, e sem o texto da
            # resposta não há como separar os dois (ver alerta_suporte.py, que
            # levou cinco testes cegos em 31/07 por causa disso).
            log(f"  WhatsApp: HTTP {r.status_code} — {r.text[:300]}"
                f"{' — retentando' if t == 0 else ' — desistindo'}")
        except Exception as e:
            log(f"  WhatsApp: erro {e}{' — retentando' if t == 0 else ' — desistindo'}")
        if t == 0:
            time.sleep(3)
    return False


def verificar_creditos_apify():
    """Verifica uso de créditos Apify e dispara alerta WhatsApp se > 80% consumido.
    Usa /users/me/limits — /users/me não retorna mais 'monthlyUsage' (a API da
    Apify mudou; o campo vem sempre ausente, e o .get(...,{}) mascarava isso
    caindo silenciosamente em $0,00/0% em toda execução, sem nunca dar erro).
    Descoberto comparando com o valor real do console da Apify (11/07/26).

    Retorna `{'uso': float, 'teto': float, 'pct': float}` ou `{}` quando não deu
    para medir — quem chama usa isso para dizer a CAUSA da coleta vazia em vez
    de listar hipóteses (ver o bloco de coleta vazia no main)."""
    if not APIFY_TOKEN:
        return {}
    try:
        r = requests.get(
            f"{APIFY_BASE}/users/me/limits",
            params={"token": APIFY_TOKEN},
            timeout=10,
        )
        if r.status_code != 200:
            log(f"  Apify credits: HTTP {r.status_code} — ignorando")
            return {}
        data = r.json().get("data", {})
        uso = data.get("current", {}).get("monthlyUsageUsd", 0) or 0
        teto = data.get("limits", {}).get("maxMonthlyUsageUsd", 0) or 0
        if not teto:
            log(f"  Apify credits: uso ${uso:.2f} (teto não identificado no plano)")
            return {}
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
                log(f"  Alerta de créditos enviado via WhatsApp (grupo)")
            # ADITIVO, e a lição do incidente de 06/08: este aviso existe para
            # a coleta não parar de surpresa, mas ia SÓ para o grupo pela
            # Evolution — que estava fora do ar desde 31/07. O teto estourou em
            # 27/07 e ninguém soube. Passando também pelo alerta_suporte, ele
            # usa a cadeia multi-provedor (Evolution -> CallMeBot -> Twilio) e
            # o número que o admin cadastrou, então um canal caído não cala o
            # aviso inteiro. Dedup de 12h: o consumo não muda de hora em hora.
            if _ALERTA_SUPORTE_OK:
                _safe(
                    "alerta de creditos ao admin",
                    _alerta.disparar,
                    "apify_creditos",
                    f"Creditos da Apify em {pct:.0f}% (US$ {uso:.2f} de US$ {teto:.2f}). "
                    f"Quando o teto fecha, a coleta volta com 0 posts. "
                    f"Recarregue em apify.com/billing.",
                    janela_dedup_min=720,
                )
        return {"uso": uso, "teto": teto, "pct": pct}
    except Exception as e:
        log(f"  Apify credits: erro ao verificar ({e})")
    return {}

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
            passou, motivo = _motivo_relevancia(caption, filtro)
            print(f"[filtro-debug #{_debug_count+1}] @{handle} ({filtro}) | passou={passou} | motivo={motivo}")
            print(f"  caption: {caption[:200]!r}")
            _debug_count += 1

        # Todo perfil cadastrado passa pelo filtro — inclusive governo (antes
        # isento). Ver filtrar_relevante, "Revisao de 25/07 (b)".
        if not filtrar_relevante(caption, filtro):
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
            # includeNestedComments: sem isso, respostas dentro de threads ficam
            # 100% de fora — achado em produção (13/07/26): um post com 227
            # comentarios segundo o Instagram so trazia 19 linhas na tabela
            # comments. Teste isolado (1 post, $0.25) confirmou: com essa flag,
            # o mesmo post foi de 19 pra 110 itens (50 de primeiro nivel + 60
            # respostas). So funciona em conta paga (Starter+) — a nossa e.
            input_data = {
                "directUrls": urls_posts,
                "resultsLimit": MAX_COMENTARIOS_POR_POST,
                "includeNestedComments": True,
            }
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

def carregar_memoria():
    """Contexto politico dos ultimos 7 dias, lido do Supabase (tabela posts).

    Substitui a leitura da aba Briefing_Diario do Google Sheets (removido do
    fluxo em 01/08/2026): o conteudo e o mesmo que a planilha recebia, agregado
    por dia a partir dos proprios posts ja analisados — score medio de imagem,
    tema (narrativa) dominante e queixa mais citada. As abas Feedback e Padroes
    (alimentacao manual, sem uso) morreram junto com a planilha.
    """
    log("=== MODULO 3 - Carregando memoria ===")
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("  Supabase ausente — memoria vazia")
        return "Sem historico anterior."

    # posts.data_post e TEXT em dd/mm/yyyy (nao filtra com gte no PostgREST);
    # o recorte de 7 dias e feito aqui, via _dia_iso, depois de trazer as
    # linhas mais recentes por atualizado_em.
    corte = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    try:
        rows = _supabase_get(
            "posts",
            f"tenant=eq.{TENANT}"
            f"&select=data_post,score_imagem,tema,queixa_dominante"
            f"&order=atualizado_em.desc&limit=600"
        ) or []
    except Exception as e:
        log(f"  posts (memoria): {e} — memoria vazia")
        return "Sem historico anterior."

    by_day = {}
    for r in rows:
        d = _dia_iso(r.get("data_post", ""))
        if d and d >= corte:
            by_day.setdefault(d, []).append(r)

    blocos = []
    if by_day:
        blocos.append("=== CONTEXTO POLITICO DOS ULTIMOS 7 DIAS ===")
        for d in sorted(by_day):
            ps = by_day[d]
            scores = [p.get("score_imagem") for p in ps if p.get("score_imagem") is not None]
            score = round(sum(scores) / len(scores), 1) if scores else ""
            temas, queixas = {}, {}
            for p in ps:
                t = (p.get("tema") or "").strip()
                if t:
                    temas[t] = temas.get(t, 0) + 1
                q = (p.get("queixa_dominante") or "").strip()
                if q:
                    queixas[q] = queixas.get(q, 0) + 1
            narr   = max(temas, key=temas.get) if temas else ""
            queixa = max(queixas, key=queixas.get) if queixas else ""
            data_br = f"{d[8:10]}/{d[5:7]}/{d[0:4]}"
            blocos.append(f"  {data_br} | Score imagem: {score} | Narrativa: {narr} | Queixa: {queixa}")

    n_posts = sum(len(v) for v in by_day.values())
    memoria = "\n".join(blocos) if blocos else "Sem historico anterior."
    log(f"  Memoria carregada: {len(blocos)} blocos ({n_posts} posts de 7 dias)")
    return memoria

# ==============================================================
# MODULO 4 - ANALISE COM O AGORA (Claude)
# ==============================================================

# ── TOM DA PUBLICACAO ───────────────────────────────────────────────────────
# Confianca minima para o tom valer como critica ou elogio. Abaixo disso a
# publicacao conta no total mas nao entra em nenhum dos dois lados — mesma
# politica de CONFIANCA_MIN_SENTIMENTO nos comentarios: quando o modelo declara
# que nao conseguiu decidir, contar como certeza infla o lado maior.
CONFIANCA_MIN_TOM = 60

TONS_VALIDOS = ("critico", "favoravel", "neutro")

# CRITERIO UNICO do tom da publicacao. Ele alimenta UM prompt so, o PROMPT_TOM,
# e essa exclusividade e a correcao mais importante deste campo.
#
# A primeira versao interpolava o criterio tambem no PROMPT_TRIAGEM e no
# PROMPT_SISTEMA, para nao gastar uma chamada extra. Medido contra a base real
# em 27/07, deu errado de um jeito instrutivo: os tres posts da inauguracao do
# Hospital Regional (obra ESTADUAL, com o presidente presente) sairam 'neutro'
# pelo classificador dedicado e 'favoravel' com confianca 95 pela triagem.
#
# O motivo e que `triar_post_rapido` injeta "[LADO: ALIADO]" e uma nota que
# diz "elogio ao que foi entregue = POSITIVO" — orientacao correta para
# classificar COMENTARIOS, que vazou para o tom. Ou seja: o atalho de
# polaridade por lado, banido em 25/07, voltava pela porta dos fundos, e ainda
# por cima o mesmo post recebia tom diferente conforme tivesse caido no tier
# rapido ou no profundo.
#
# Agora o tom e decidido por uma chamada que ve APENAS a legenda: nao sabe de
# quem e a conta, nao ve os comentarios, nao tem como deduzir por lado. Como o
# tom depende so da legenda, que nunca muda, ele e calculado UMA VEZ por post
# (ver analisar_com_agora) — nas execucoes seguintes o valor gravado e
# reaproveitado, o que sai mais barato que a versao "sem chamada extra".
CRITERIO_TOM_PUBLICACAO = (
    "TOM DA PUBLICACAO (campo 'tom_publicacao'): o que o PERFIL DISSE sobre a "
    "gestao municipal de Alagoinhas no TEXTO DA PROPRIA PUBLICACAO. "
    "NAO e a reacao dos comentarios, NAO e o clima do post, NAO e o que o "
    "publico achou: e a fala de quem publicou. Um post elogioso da prefeitura "
    "que recebeu enxurrada de criticas continua sendo 'favoravel', porque o tom "
    "mede o que a prefeitura disse, nao o que responderam a ela.\n"
    "PORTAO (decida isto ANTES de qualquer outra regra): 'esta publicacao emite "
    "juizo sobre a GESTAO MUNICIPAL DE ALAGOINHAS?' So passa quem avalia, "
    "elogia, cobra ou critica o prefeito Gustavo Carmo, a prefeitura, uma "
    "secretaria, uma obra, um programa ou um servico municipal. Se nao passar "
    "no portao, o tom e 'neutro', e NENHUMA regra abaixo sobrepoe o portao.\n"
    "TOM OTIMISTA SOBRE A CIDADE NAO E ELOGIO A GESTAO. Noticia boa sobre "
    "economia, comercio, festa, cultura, tradicao, time, clima ou 'novo momento "
    "da cidade', sem creditar aquilo a uma acao da prefeitura, e 'neutro'. "
    "Obra ou servico de OUTRO ENTE (governo estadual, governo federal, hospital "
    "regional, universidade, concessionaria) e 'neutro' para a gestao municipal, "
    "mesmo quando o texto e entusiasmado e mesmo quando o prefeito aparece na "
    "foto: so vira 'favoravel' se o texto atribuir merito a prefeitura.\n"
    "NAO DEDUZA PELO LADO DO PERFIL. Perfil de oposicao publica agenda, "
    "aniversario e agradecimento, e isso e 'neutro'. Conta oficial da gestao "
    "publica utilidade publica (IPTU, horario, interdicao, vagas, edital, "
    "inscricao de curso), e isso tambem e 'neutro'. Quem define e o texto, "
    "nunca de quem e a conta.\n"
    "AUTOPROMOCAO DE POLITICO NAO E JUIZO SOBRE A GESTAO. Politico contando a "
    "propria agenda, apresentando sua equipe, descrevendo seu metodo de "
    "trabalho ('a gente caminha, escuta as ruas, fiscaliza') ou anunciando "
    "evento proprio esta falando de SI, nao da prefeitura: e 'neutro'. So vira "
    "'critico' se o texto tambem reprovar a gestao, e so vira 'favoravel' se "
    "elogiar a gestao junto. Esta e a mesma regra que vale para comentario: "
    "falar bem de um lado nao equivale a falar mal do outro.\n"
    "  critico   = a publicacao reprova, denuncia, cobra com reprovacao, "
    "expoe falha ou ironiza a gestao, o prefeito, a prefeitura, uma secretaria, "
    "uma obra ou um servico municipal. Vale tambem quando o perfil noticia a "
    "denuncia de terceiros enquadrando-a como falha da gestao ('moradores "
    "denunciam abandono da rua X').\n"
    "  favoravel = a publicacao elogia, defende de uma critica, ou promove "
    "como conquista uma realizacao, entrega, obra ou programa DA PREFEITURA "
    "('entregamos a nova UBS', 'gestao investe R$ 2 mi em saude', 'prefeitura "
    "recupera 40 ruas').\n"
    "  neutro    = passa longe do portao, informa sem julgar, ou cobre os dois "
    "lados sem enquadrar como falha nem como merito.\n"
    "EXEMPLOS — OBRIGATORIO ACERTAR:\n"
    "  'Inauguracao do Hospital Regional com a presenca do presidente Lula' "
    "-> neutro (obra estadual/federal; nada dito sobre a prefeitura)\n"
    "  'Alagoinhas esta prestes a viver um novo momento na saude publica' "
    "-> neutro (otimismo sobre a cidade sem creditar acao da prefeitura)\n"
    "  'Alvorada de Santa Terezinha celebra tradicao e movimenta a economia' "
    "-> neutro (evento cultural; a gestao nao e avaliada)\n"
    "  'Seu carne do IPTU 2026 esta a um zap de distancia' "
    "-> neutro (utilidade publica da propria prefeitura)\n"
    "  'Sao Joao realizado sem comprometer recursos proprios do municipio' "
    "-> favoravel (credita merito de gestao a prefeitura)\n"
    "  'Prefeitura entregou a reforma da praca do bairro X' -> favoravel\n"
    "  'A conta nao fecha e quem paga e sempre quem ganha menos' (sobre tarifa "
    "municipal) -> critico\n"
    "  'Moradores do Riacho da Guia estao ha tres dias sem agua' -> critico\n"
    "IRONIA exige a contradicao no proprio texto (fato que desmente o elogio, "
    "aspas ironicas, exagero absurdo). Emoji de risada, '😂' e 'kkkk' NAO sao "
    "prova de ironia.\n"
    "COBRANCA sem reprovacao e 'neutro': pergunta, pedido de informacao ou "
    "encaminhamento de demanda sem juizo sobre a gestao.\n"
    "CONFIANCA ('confianca_tom', 0-100): baixe abaixo de 60 quando a publicacao "
    "nao tiver legenda, for so foto/emoji, for ambigua ou tratar da gestao de "
    "forma tao lateral que o tom seja chute. Preferir confianca baixa a "
    "inventar um lado."
)

# Alinhado ao PROMPT_COMENTARIOS na auditoria de 26/07. Este prompt tinha
# ficado para tras na revisao de 25/07: continuava mandando classificar apoio a
# opositor como NEGATIVO, o atalho que fabricava critica que ninguem escreveu.
# Nao e detalhe cosmetico: a triagem produz score_risco, urgencia e risco_crise,
# e e ela que decide se o post sobe para o Sonnet. Esses campos alimentam
# alerta, boletim e Cacador de Crises, e o recalcular_sentimento_posts (que
# conserta os percentuais a partir dos comentarios) nao toca em nenhum deles.
PROMPT_TRIAGEM = (
    "Classificador rapido de risco politico. "
    "O QUE VOCE MEDE: o sentimento que o CIDADAO EXPRESSOU sobre a atual gestao "
    "municipal de Alagoinhas/BA (prefeito Gustavo Carmo, prefeitura, secretarias, "
    "obras, programas e servicos publicos). Voce le a opiniao que a pessoa "
    "escreveu, nao deduz o que ela significaria politicamente. Se o cidadao nao "
    "avaliou a gestao, o dado correto e NEUTRO, em nenhuma direcao. "
    "PORTAO (decida isto antes de qualquer outra regra): 'este comentario avalia "
    "a GESTAO MUNICIPAL?' So passa quem cita ou implica diretamente o prefeito, a "
    "prefeitura, a gestao, uma secretaria, uma obra, um programa municipal ou a "
    "qualidade de um servico publico. Se nao passar, e NEUTRO, e nenhuma regra "
    "abaixo sobrepoe o portao. "
    "POSITIVO = o cidadao aprovou algo da gestao (elogia obra, servico, programa "
    "ou o prefeito; defende a gestao de uma critica; contesta quem esta criticando). "
    "NEGATIVO = o cidadao reprovou algo da gestao (critica, denuncia, reclama de "
    "servico, ironiza a gestao, ou endossa a denuncia que o post faz a gestao). "
    "APOIO A OPOSITOR NAO E, POR SI SO, CRITICA A GESTAO: elogiar vereador ou "
    "politico local de oposicao ('parabens vereador', 'voce e o proximo prefeito') "
    "e sentimento sobre AQUELA PESSOA, e o cidadao nao disse nada sobre a gestao: "
    "classifique NEUTRO. So vira NEGATIVO se o proprio comentario tambem reprovar "
    "a gestao, explicitamente ou endossando a denuncia do post. Simetricamente, "
    "atacar um opositor so e POSITIVO se defender a gestao junto. "
    "RISADA NAO E PROVA DE IRONIA: 😂 e 'kkkk' aparecem em deboche, mas tambem em "
    "concordancia e no riso de quem DEFENDE a gestao. Para marcar ironia e preciso "
    "a contradicao no proprio texto (fato que desmente o elogio, aspas ironicas, "
    "exagero absurdo). "
    "COBRANCA SO E NEGATIVA QUANDO HA REPROVACAO: pergunta ou recado sem "
    "reclamacao e NEUTRO. "
    "Animacao com artista/banda em evento ('Vamos!', 'Que show!'), reacao emocional pura, "
    "comentario religioso/cultural sem conexao com atos da gestao = NEUTRO, nunca POSITIVO. "
    "Reclamacao sobre terceiros, comercio, outros cidadaos ou tema geral que NAO "
    "responsabiliza a gestao = NEUTRO, nunca NEGATIVO. "
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
    # O LADO do perfil e contexto de leitura, NAO atalho de polaridade (mesma
    # regra de montar_prompt_comentarios; ver PROMPT_TRIAGEM).
    nota_lado = (
        "CONTEXTO: a publicacao e de um perfil OPOSITOR a gestao. Isso ajuda a "
        "entender o assunto, mas NAO define a polaridade. Elogiar o opositor sem "
        "reprovar a gestao e NEUTRO; so e NEGATIVO se o comentario tambem critica a "
        "gestao ou endossa a denuncia feita no post."
        if lado == "OPOSITOR" else
        "CONTEXTO: a publicacao e de um perfil ALIADO/GOVERNO (conta oficial da "
        "gestao). Elogio ao que foi entregue = POSITIVO; reclamacao ou cobranca com "
        "reprovacao dirigida a gestao = NEGATIVO; recado e pergunta sem juizo = NEUTRO."
        if lado == "ALIADO" else
        "CONTEXTO: a publicacao e de imprensa. Leia cada comentario pelo que ele diz "
        "sobre a gestao municipal; se a materia for sobre outra cidade ou sobre "
        "politica nacional, os comentarios sao NEUTROS."
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

  POSITIVO = o cidadao APROVOU algo da gestao
    - Elogio direto ao prefeito ou a gestao municipal
    - Defesa do prefeito contra criticas
    - Apoio a obras, programas ou secretarias da prefeitura
    - Lembrar realizacoes da gestao positivamente
    - Contestar quem esta criticando a gestao
    - Atacar um opositor SOMENTE quando o comentario tambem defende a
      gestao junto ("Luciano e incompetente, prefiro Gustavo")

  NEGATIVO = o cidadao REPROVOU algo da gestao
    - Critica direta ao prefeito ou a gestao municipal
    - Queixas concretas sobre servicos municipais (saude, educacao,
      obras, limpeza, IPTU, transporte)
    - Comparacoes desfavoraveis com outras gestoes/cidades
    - Sarcasmo, ironia ou descrenca sobre promessas (ver secao IRONIA abaixo)
    - Acusacao de que o perfil/portal e "pago", "patrocinado" ou "passa pano" pela gestao
    - Endossar a denuncia que o post faz a gestao ("e verdade, aqui e assim mesmo")
    - Apoiar um opositor SOMENTE quando o comentario tambem reprova a
      gestao ("esse sim trabalha, diferente do atual")

  APOIO A OPOSITOR, SOZINHO, NAO E CRITICA A GESTAO:
    Elogiar vereador ou politico local de oposicao ("parabens vereador",
    "voce tem meu respeito", "vai ser nosso proximo prefeito") e sentimento
    sobre AQUELA PESSOA. O cidadao nao disse nada sobre a gestao: e NEUTRO.
    Simetricamente, atacar opositor sem defender a gestao tambem e NEUTRO.
    Esta regra ja fabricou 400 criticas que ninguem escreveu; nao a afrouxe.

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
  "Acompanho voce Luciano, vai ser nosso prefeito"          -> NEUTRO (apoio ao opositor, nada dito sobre a gestao)
  "Esse sim trabalha, diferente do atual"                   -> NEGATIVO (apoio ao opositor + reprova a gestao)
  "Luciano e incompetente, prefiro Gustavo"                 -> POSITIVO (ataca opositor + defende a gestao)
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
  0. PRE-REQUISITO: risada sozinha (😂 🤣 😆 kkkk) NAO e prova de ironia.
     Ela aparece tambem em concordancia, piada e no riso de quem DEFENDE
     a gestao. Para marcar ironia, o texto precisa trazer a contradicao
     junto — um fato que desmente o elogio, aspas ironicas, exagero
     absurdo. Sem essa evidencia no texto, leia o comentario pelo que
     ele diz literalmente.
     Risada dirigida a QUEM CRITICA a gestao ("quem ta reclamando fica
     em casa 😂") e DEFESA da gestao, nao ataque.
  1. Emojis de risada (😂 🤣 😆 😅) combinados com "elogio" ou referencia
     a uma "conquista" da gestao E um fato citado que desmente o elogio
     = o cidadao esta RINDO DA gestao, nao aplaudindo.
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
  Mas exija os TRES elementos. So o emoji nao basta: sem a critica junto,
  classifique pelo sentido literal e baixe a confianca.
═══════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════
REGRA CRITICA: COMO CLASSIFICAR "sentimento_post"
═══════════════════════════════════════════════════════════════════════
"sentimento_post" NAO e o tom da legenda (caption) do post.
E o IMPACTO LIQUIDO na imagem do prefeito, medido pela reacao do povo.
O post e apenas o gatilho — o que importa e O QUE O POVO RESPONDEU.

REGRA:
  Se cidadaos criticaram, ironizaram ou reclamaram da GESTAO nos
  comentarios -> sentimento_post = "negativo"
  Se cidadaos elogiaram, defenderam ou apoiaram a gestao -> "positivo"
  Reacao mista sem clara maioria -> "neutro"

  Apoio a um opositor, sozinho, NAO conta como reacao negativa: so conta
  o que o cidadao disse sobre a GESTAO. Ver a regra 1 do classificador de
  comentarios — a polaridade nao e deduzida de quem o cidadao apoia.

REFERENCIA QUANTITATIVA (guia, nao regra absoluta) — os dois lados usam o
MESMO limiar, para o painel nao pender para nenhuma direcao:
  comentarios_pct_neg > 50% -> sentimento_post = "negativo"
  comentarios_pct_pos > 50% -> sentimento_post = "positivo"
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
  Regras de derivacao (simetricas — critica e elogio pesam igual):
    sentimento_comentarios = "negativo"            -> sentimento_post = "negativo"
    sentimento_comentarios = "misto" e pct_neg > pct_pos -> sentimento_post = "negativo"
    sentimento_comentarios = "misto" e pct_pos > pct_neg -> sentimento_post = "positivo"
    sentimento_comentarios = "misto" e empate      -> sentimento_post = "neutro"
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

NUNCA use travessao (— ou –) nos textos gerados; use virgula, dois-pontos ou parenteses.
Todo texto gerado deve estar em portugues do Brasil correto, com acentuacao e ortografia
certas: escreva "saúde pública", "gestão", "crítica", nunca "saude publica", "gestao",
"critica". As instrucoes deste prompt estao sem acento; NAO imite esse estilo na resposta.
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
    # O lado do perfil e contexto de leitura, nunca atalho de polaridade: o que
    # vale e o que o cidadao escreveu sobre a GESTAO (ver PROMPT_COMENTARIOS,
    # regra 1). Antes esta linha mandava tratar apoio ao opositor como negativo.
    cat_lower = (post.get("categoria") or "").lower()
    if cat_lower == "oposicao":
        lado = ("OPOSITOR da gestao — contexto, nao polaridade: apoio a esse perfil "
                "sozinho e NEUTRO; so conta como negativo o que criticar a gestao")
    elif cat_lower in ("prefeito", "prefeitura", "governo"):
        lado = ("ALIADO/GESTAO — conta oficial da gestao: elogio ao que foi entregue "
                "e POSITIVO, cobranca com reprovacao e NEGATIVO")
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
    "Classificador de comentarios de cidadaos em posts politicos de Alagoinhas/BA.\n\n"
    "O QUE VOCE ESTA MEDINDO: o sentimento que o CIDADAO EXPRESSOU sobre a atual "
    "gestao municipal (prefeito Gustavo Carmo, prefeitura, secretarias, obras, "
    "programas e servicos publicos do municipio). Voce esta lendo a opiniao real de "
    "quem escreveu, nao deduzindo o que ela significaria politicamente. Se o "
    "cidadao nao avaliou a gestao, o dado correto e NEUTRO — nunca invente um "
    "sentimento que a pessoa nao manifestou, em nenhuma direcao.\n\n"
    "═══ PASSO 1 — PORTAO (decida isto ANTES de qualquer outra regra) ═══\n"
    "Pergunta unica: 'este comentario avalia a GESTAO MUNICIPAL DE ALAGOINHAS?'\n"
    "So passa no portao o comentario que cita ou implica diretamente o prefeito "
    "Gustavo, a prefeitura, a gestao municipal, uma secretaria, uma obra, um "
    "programa municipal ou a qualidade de um servico publico do municipio.\n"
    "Se NAO passar, o comentario e NEUTRO e o PASSO 2 nem chega a ser aplicado. "
    "Nenhuma regra abaixo (ironia, risada, apoio a politico, tom agressivo) "
    "sobrepoe o portao. Sao SEMPRE NEUTROS:\n"
    "  - orgulho civico generico pela cidade ('bela cidade', 'parabens Alagoinhas')\n"
    "  - elogio a artista, banda, evento, canal de midia ou pessoa publica\n"
    "  - politica estadual, federal ou partidaria sem ligar ao municipio\n"
    "  - apoio ou ataque a politico de FORA de Alagoinhas (prefeito de outra cidade, "
    "governador, deputado, presidente), mesmo com nome familiar\n"
    "  - conversa entre pessoas, marcacao de amigo, recado sem juizo sobre a gestao\n\n"
    "═══ PASSO 2 — POLARIDADE (so para o que passou no portao) ═══\n"
    "POSITIVO = o cidadao aprovou algo da gestao (elogia obra, servico, programa ou "
    "o prefeito; defende a gestao de uma critica; contesta quem esta criticando).\n"
    "NEGATIVO = o cidadao reprovou algo da gestao (critica, denuncia, reclama de "
    "servico, ironiza a gestao, ou endossa a critica que o post faz a gestao).\n"
    "NEUTRO = passou no portao mas nao tem juizo de valor (pergunta factual, "
    "informacao, comentario descritivo).\n\n"
    "═══ REGRAS QUE JA CAUSARAM ERRO — LEIA COM ATENCAO ═══\n\n"
    "1) APOIO A OPOSITOR NAO E, POR SI SO, CRITICA A GESTAO. E NUNCA E POSITIVO.\n"
    "   Elogiar um vereador ou politico local de oposicao ('parabens vereador', "
    "'voce tem meu respeito', 'e o proximo prefeito') e sentimento sobre AQUELA "
    "PESSOA. O cidadao nao disse nada sobre a gestao: classifique NEUTRO.\n"
    "   Desejar o opositor NO CARGO ('tem que virar prefeito', 'meu voto e seu', "
    "'a cidade precisa de voce') continua sendo apoio a pessoa: NEUTRO. 'Prefeito' "
    "no desejo de que ELE assuma nao e mencao a gestao atual — nao classifique "
    "POSITIVO por causa da palavra.\n"
    "   Exaltar o opositor com desdem GENERICO pelos demais ('so voce fala a "
    "verdade', 'o resto e resto', 'os outros nao prestam') tambem e NEUTRO: 'o "
    "resto' nao nomeia a gestao, e inventar o alvo seria fabricar sentimento.\n"
    "   So vira NEGATIVO se o proprio comentario tambem reprovar a gestao — "
    "explicitamente ('esse sim trabalha, diferente do atual') ou endossando a "
    "denuncia do post ('e verdade, aqui e assim mesmo', 'concordo, abandonaram').\n"
    "   Simetricamente: atacar um opositor so e POSITIVO se defender a gestao junto.\n\n"
    "2) RISADA NAO E PROVA DE IRONIA.\n"
    "   😂🤣😆 e 'kkkk' aparecem em deboche, mas tambem em concordancia, piada "
    "interna e riso de quem DEFENDE a gestao. Para marcar ironia voce precisa de "
    "evidencia NO TEXTO: contradicao entre o elogio e um fato citado ('parabens "
    "pela obra que ta abandonada ha 2 anos'), exagero absurdo, ou aspas ironicas.\n"
    "   Risada dirigida a QUEM CRITICA a gestao e defesa da gestao, nao ataque: "
    "'quem ta reclamando das bandas fica em casa 😂, a alvorada ta maravilhosa' "
    "-> POSITIVO.\n"
    "   Na duvida entre ironia e elogio sincero, use NEUTRO e confianca_tema < 50.\n\n"
    "3) COBRANCA SO E NEGATIVA QUANDO HA REPROVACAO.\n"
    "   Pedido ou pergunta sem reclamacao ('envia esse video pra CDL', 'vai ter "
    "inscricao pra que idade?') e NEUTRO — a demanda ja e registrada no campo "
    "'pedido', nao precisa virar critica.\n"
    "   E NEGATIVO quando a cobranca carrega insatisfacao: promessa nao cumprida, "
    "abandono, demora, algo que deveria existir e nao existe ('cade o asfalto que "
    "prometeram?', 'ha 2 meses sem luz e ninguem vem').\n\n"
    "4) POST DE OUTRO MUNICIPIO NAO GERA SENTIMENTO SOBRE ALAGOINHAS.\n"
    "   Se a publicacao trata da gestao de outra cidade, todo comentario sobre "
    "aquele prefeito ou aquela obra e NEUTRO aqui, inclusive elogio ('meu prefeito "
    "e top') e deboche ('parabens prefeito kkkk').\n\n"
    "EXEMPLOS — OBRIGATORIO ACERTAR:\n"
    "  'ACM Neto, eleito no primeiro turno 🔥' -> NEUTRO (politico de fora)\n"
    "  '@fulano faz qualquer um se apaixonar por Alagoinhas, amo o canal dela' -> "
    "NEUTRO (elogio a canal de midia, nao a gestao)\n"
    "  'Uma honra poder contar as historias dessa bela cidade' -> NEUTRO (orgulho civico)\n"
    "  'Parabens Alagoinhas ba' -> NEUTRO (elogio a cidade, nao a gestao)\n"
    "  'Nao suporto esse povo do PT 😂😂' -> NEUTRO (partido, nao a gestao municipal)\n"
    "  'Brabos, tem o meu respeito 🙌' (em post de vereador opositor) -> NEUTRO "
    "(elogio ao vereador, nada dito sobre a gestao)\n"
    "  'Luciano, voce e cotado pra ser prefeito 👏' -> NEUTRO (apoio ao opositor, "
    "sem reprovar a gestao atual)\n"
    "  '@opositor e @vereador, vcs tem que virar prefeito e vice urgente' -> NEUTRO "
    "(deseja os opositores no cargo; nada dito sobre a gestao atual)\n"
    "  'O povo so ve voce e ele a favor do povo, o resto e resto' (em post de "
    "opositor) -> NEUTRO (exalta o opositor; 'o resto' nao nomeia a gestao)\n"
    "  'Concordo plenamente, quando e alguem do sistema eles atendem rapidinho' -> "
    "NEGATIVO (endossa a denuncia sobre o servico publico)\n"
    "  'Se nao faz Sao Joao o povo reclama, se faz critica, dificil ufa' -> POSITIVO "
    "(defende a gestao dos criticos)\n"
    "  'Envia esse video pra CDL' -> NEUTRO (recado, sem juizo sobre a gestao)\n"
    "  'SUS de Alagoinhas da certo, parabens equipe!' -> POSITIVO\n"
    "  'Prefeitura abandonou minha rua, ha 2 meses sem luz' -> NEGATIVO\n"
    "  'Cade o asfalto que prometeram na campanha?' -> NEGATIVO (cobranca com reprovacao)\n"
    "  'Luciano e incompetente, prefiro Gustavo' -> POSITIVO (defende a gestao)\n\n"
    "TEMA: e o tema DO COMENTARIO, nao do post — um cidadao pode reclamar da UPA debaixo "
    "de um post sobre pavimentacao. Se o comentario for NEUTRO (nao passou no portao "
    "obrigatorio acima), use tema='outro'.\n"
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
    "demais para decidir. ABAIXO DE 50 quando voce honestamente nao conseguiu decidir a "
    "polaridade — comentarios assim ficam FORA da conta do clima, entao e melhor admitir a "
    "duvida do que chutar positivo ou negativo e enviesar o painel.\n\n"
    "Retorne APENAS JSON valido, sem markdown, sem texto extra."
)

def montar_prompt_comentarios(post, lote, offset):
    """Monta o prompt de um lote de ate LOTE_COMENTARIOS comentarios, numerados
    com indice GLOBAL (offset + posicao no lote) — nao reinicia a cada lote."""
    cat = (post.get("categoria") or "").lower()
    lado = ("OPOSITOR" if cat == "oposicao"
            else "ALIADO" if cat in ("prefeito", "prefeitura", "governo")
            else "IMPRENSA")
    # O LADO do perfil e contexto de leitura, NAO um atalho de polaridade: quem
    # decide e o que o cidadao escreveu. Antes esta nota mandava marcar como
    # NEGATIVO todo elogio a um perfil opositor, o que fabricava critica a gestao
    # a partir de comentarios que nao falavam da gestao (400 comentarios na base
    # de 25/07). Ver PROMPT_COMENTARIOS, regra 1.
    nota_lado = (
        "CONTEXTO: a publicacao e de um perfil OPOSITOR a gestao. Isso ajuda a "
        "entender o assunto, mas NAO define a polaridade. Elogiar o opositor sem "
        "reprovar a gestao e NEUTRO; so e NEGATIVO se o comentario tambem critica a "
        "gestao ou endossa a denuncia feita no post."
        if lado == "OPOSITOR" else
        "CONTEXTO: a publicacao e de um perfil ALIADO/GOVERNO (conta oficial da "
        "gestao). Elogio ao que foi entregue = POSITIVO; reclamacao ou cobranca com "
        "reprovacao dirigida a gestao = NEGATIVO; recado e pergunta sem juizo = NEUTRO."
        if lado == "ALIADO" else
        "CONTEXTO: a publicacao e de imprensa. Leia cada comentario pelo que ele diz "
        "sobre a gestao municipal; se a materia for sobre outra cidade ou sobre "
        "politica nacional, os comentarios sao NEUTROS."
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
        # ONDE na cidade, e nao QUAL equipamento. A formulacao anterior pedia
        # "bairro/praca/rua/escola citado" e convidava o modelo a devolver o
        # nome do servico: "Centro de Testagem e Aconselhamento" virava o
        # bairro Centro depois da normalizacao (achado de 27/07).
        '"localidade": "<APENAS bairro, povoado, praca ou rua da cidade, como escrito. '
        'Nome de equipamento ou programa (posto, CTA, hospital, UPA, escola, creche, '
        'secretaria) NAO e localidade: use null, a menos que o texto tambem diga em que '
        'bairro ele fica, e ai devolva o BAIRRO. null quando nao houver lugar citado>", '
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
                temperature=0,
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
    # Tom da publicacao: o default e "nao medido", nunca "neutro" (ver
    # normalizar_tom e a migration 010). Nenhum prompt de analise devolve este
    # campo — quem preenche e a chamada dedicada em analisar_com_agora.
    "tom_publicacao": "nao_classificado", "confianca_tom": 0,
}

PROMPT_TOM = (
    "Classificador do TOM de uma publicacao sobre a gestao municipal de "
    "Alagoinhas/BA (prefeito Gustavo Carmo). Voce recebe SO o texto publicado "
    "pelo perfil, sem comentarios, porque o que se mede aqui e a fala de quem "
    "publicou.\n\n"
    + CRITERIO_TOM_PUBLICACAO +
    '\n\nRetorne APENAS JSON valido, sem markdown: '
    '{"tom_publicacao":"<critico|favoravel|neutro>","confianca_tom":<0-100>}'
)


def normalizar_tom(analise):
    """Devolve (tom, confianca) validados a partir de uma resposta do modelo.

    Grafia fora do conjunto valido vira 'nao_classificado' em vez de escorregar
    para 'neutro': "nao medido" e "medido e deu neutro" sao coisas diferentes na
    contagem da tela Analise por Perfil, e a constraint da migration 010
    recusaria o valor de qualquer forma.
    """
    tom = str(analise.get("tom_publicacao") or "").strip().lower()
    try:
        conf = int(float(analise.get("confianca_tom") or 0))
    except (TypeError, ValueError):
        conf = 0
    conf = max(0, min(100, conf))
    if tom not in TONS_VALIDOS:
        return "nao_classificado", conf
    return tom, conf


def classificar_tom_publicacao(caption, cliente):
    """Classifica o tom de UMA publicacao a partir da caption.

    Usada pela reclassificacao da base e pelo harness `--teste-tom`. No
    pipeline o tom ja vem junto da triagem/analise profunda, sem chamada extra.
    Publicacao sem legenda nao vai para o modelo: nao ha texto para ler, e
    inventar um tom a partir do nada e exatamente o que se quer evitar.
    """
    texto = (caption or "").strip()
    if not texto:
        return "nao_classificado", 0
    try:
        r = cliente.messages.create(
            model=MODELO_ANALISTA,
            max_tokens=90,
            system=PROMPT_TOM,
            messages=[{"role": "user", "content": f"Publicacao:\n{texto[:1500]}"}],
        )
        return normalizar_tom(_parse_json_resposta(r.content[0].text))
    except Exception as e:
        log(f"    tom falhou ({e})")
        return "nao_classificado", 0


def _parse_json_resposta(texto):
    """Remove bloco markdown e faz parse do JSON."""
    texto = texto.strip()
    if texto.startswith("```"):
        texto = texto.split("```")[1]
        if texto.startswith("json"):
            texto = texto[4:]
    return json.loads(texto.strip())


# ==============================================================
# MODULO 4c - ESCUTA DO RADIO
# ==============================================================
# O radio_analise.py nao reimplementa nenhuma regra: ele RECEBE daqui o
# criterio de relevancia, o criterio de tom, o vocabulario de temas e o
# normalizador de localidade. Foi assim de proposito — PROMPT_TRIAGEM e
# PROMPT_COMENTARIOS passaram um mes divergindo justamente porque cada um tinha
# a sua copia do mesmo criterio, e ninguem percebeu ate a auditoria de 26/07.

def _contexto_radio(mapa_bairros=None):
    """Monta o Contexto que o radio_analise consome.

    A radio e tratada como IMPRENSA no filtro de relevancia: uma estacao local
    cobre a regiao e comenta outros municipios, que e exatamente a razao pela
    qual a ancora do municipio passou a ser exigida dos veiculos. Trecho com
    palavra generica ('a prefeitura', 'o prefeito') sem ancora do tenant nao
    prova que se fala DAQUI, e nao sobe para o modelo.
    """
    mapa = (mapa_bairros if mapa_bairros is not None
            else carregar_bairros(TENANT, abortar_em_falha=False))

    def _candidato(texto):
        """Localizador do primeiro estagio: 'ha alguma keyword cadastrada neste
        segmento?'. Permissivo de proposito — quem decide e o gate, sobre a
        janela inteira. As palavras sao as MESMAS cadastradas pelo cliente na
        tela Relevancia; nada e adicionado aqui."""
        return any(_contem_termo(texto, kw) for kw in KEYWORDS_IMPRENSA)

    return _radio_an.Contexto(
        gate=lambda texto: _motivo_relevancia(texto, "imprensa")[0],
        candidato=_candidato,
        criterio_tom=CRITERIO_TOM_PUBLICACAO,
        temas_validos=frozenset(TEMAS_VALIDOS),
        normalizar_localidade=lambda valor: normalizar_localidade(valor, mapa, TENANT),
    )


def analisar_radio(limite=20, dry_run=False, refazer=False, mapa_bairros=None):
    """Analisa as transcricoes de radio pendentes.

    Usa o Haiku (MODELO_ANALISTA): a tarefa e extrair e resumir trecho curto de
    texto, nao arbitrar crise. O custo por bloco ja e contido pelo portao de
    relevancia, que descarta a musica e a publicidade antes de qualquer chamada.
    """
    if not _RADIO_OK:
        log("  radio_analise indisponivel (falha de import).")
        return {"blocos": 0, "pautas": 0, "chamadas": 0}
    cliente = _cliente_anthropic()
    return _radio_an.analisar_pendentes(
        _contexto_radio(mapa_bairros), cliente, MODELO_ANALISTA,
        limite=limite, dry_run=dry_run, refazer=refazer,
    )


def teste_radio(limite=3):
    """Harness do --teste-radio: le transcricoes ja gravadas, analisa e imprime,
    sem escrever nada. Custo: so Anthropic, zero credito Apify."""
    if not _RADIO_OK:
        log("radio_analise indisponivel (falha de import).")
        return
    cliente = _cliente_anthropic()
    _radio_an.teste_radio(_contexto_radio(), cliente, MODELO_ANALISTA, limite=limite)


def expurgar_pii_radio(dias=None, dry_run=False):
    """Apaga a transcricao bruta e os segmentos das capturas de radio fora da
    janela de retencao, preservando as pautas ja extraidas.

    Por que radio tambem entra na LGPD: a transcricao registra ouvinte que liga
    e se identifica ("boa tarde para Diego ali na Rua da Usina" apareceu no
    primeiro teste real), e opiniao politica de pessoa identificada e dado
    sensivel. O que sobrevive ao expurgo e o que sustenta a serie historica:
    assunto, resumo, tema, tom, localidade e o instante da citacao.

    Retencao mais curta que a dos comentarios (90 x 180 dias): a transcricao e
    volumosa, contem terceiro que nunca escolheu falar com o sistema (quem liga
    para a radio nao publicou nada) e o valor analitico dela ja foi extraido
    para radio_topics na primeira analise.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("[expurgo-radio] SUPABASE ausente — abortando.")
        return 0

    dias = int(dias if dias is not None else RETENCAO_RADIO_DIAS)
    corte = (datetime.now() - timedelta(days=dias)).isoformat()
    base = f"tenant=eq.{TENANT}&inicio_ts=lt.{corte}&pii_expurgado_em=is.null"

    linhas = _supabase_get("radio_transcripts", f"{base}&select=id&limit=1000")
    if not linhas:
        log(f"[expurgo-radio] nada a expurgar (retencao={dias}d)")
        return 0
    if dry_run:
        log(f"[expurgo-radio] {len(linhas)} captura(s) seriam expurgadas (retencao={dias}d)")
        return len(linhas)

    # Os clipes de audio da citacao saem JUNTO. Apagar o texto e deixar a voz
    # do ouvinte no storage seria pior do que nao ter apagado nada — e o clipe e
    # o unico artefato do sistema em que a pessoa e reconhecivel pela voz.
    _ids = [l["id"] for l in linhas if l.get("id")]
    if _ids:
        _clipes_alvo = [
            r["audio_clip"] for r in (_supabase_get(
                "radio_topics",
                "transcript_id=in.(" + ",".join(_ids) + ")"
                "&audio_clip=not.is.null&select=audio_clip&limit=2000",
            ) or []) if r.get("audio_clip")
        ]
        if _clipes_alvo:
            try:
                import radio_clipes as _rc
                _n = _rc.apagar(_clipes_alvo)
                log(f"[expurgo-radio] {_n} clipe(s) de audio apagados do storage")
                _supabase_patch(
                    "radio_topics",
                    "transcript_id=in.(" + ",".join(_ids) + ")&audio_clip=not.is.null",
                    {"audio_clip": None},
                )
            except Exception as e:
                log(f"[expurgo-radio] falha ao apagar clipes: {e}")

    ok = _supabase_patch("radio_transcripts", base, {
        "transcricao": None,
        "segments": [],
        "pii_expurgado_em": datetime.now().isoformat(),
    })
    if ok:
        log(f"[expurgo-radio] {len(linhas)} captura(s) expurgadas")
        return len(linhas)
    log(f"[expurgo-radio] FALHOU o PATCH de {len(linhas)} capturas")
    return 0


def analisar_com_agora(posts, comentarios_por_post, memoria, mapa_bairros):
    log(f"=== MODULO 4 - Analisando com o AGORA (triagem 2 niveis | limiar={LIMIAR_TRIAGEM}) ===")
    log(f"    Triagem: {MODELO_ANALISTA} | Profundo: {MODELO_PROFUNDO} | Comentarios: {MODELO_ANALISTA}")
    cliente = _cliente_anthropic()
    resultado = []
    n_profundo = n_rapido = n_tom_novo = 0

    # Tom ja classificado, por URL. O tom depende SO da legenda, e legenda nao
    # muda: reclassificar a cada execucao seria pagar 3x por dia para receber a
    # mesma resposta. Em regime, so os posts novos custam uma chamada.
    tom_gravado = {}
    for _r in _supabase_get(
        "posts", f"tenant=eq.{TENANT}&select=url,tom_publicacao,confianca_tom&limit=5000"
    ) or []:
        _t = _r.get("tom_publicacao") or "nao_classificado"
        if _t != "nao_classificado":
            tom_gravado[(_r.get("url") or "").strip()] = (_t, int(_r.get("confianca_tom") or 0))

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
        # sentimento_comentarios.
        #
        # Simetrico de proposito (revisao de 25/07). Antes exigia pct_neg > 50
        # para negativo mas pct_pos > 60 para positivo, e "misto" so descia para
        # negativo — reacao favoravel dominante virava "neutro". Isso e um dedo
        # na balanca: o painel media mais critica do que a populacao expressou.
        #
        # Tambem caiu aqui a inversao por oposicao (pct_pos > 60 e oposicao ->
        # negativo). Os comentarios ja chegam classificados pelo impacto na
        # gestao, entao pct_pos JA significa "favoravel a gestao"; inverter de
        # novo transformava aprovacao em critica. Nao chegou a aparecer na base
        # (nenhum post de oposicao passou de 60% favoravel ate 25/07), mas
        # dispararia justamente no caso que o cliente mais quer enxergar.
        pct_neg = float(analise.get("comentarios_pct_neg", 0) or 0)
        pct_pos = float(analise.get("comentarios_pct_pos", 0) or 0)
        sent_coments = (analise.get("sentimento_comentarios") or "").lower()
        if pct_neg > 50:
            analise["sentimento_post"] = "negativo"
        elif pct_pos > 50:
            analise["sentimento_post"] = "positivo"
        elif sent_coments == "negativo" and analise_profunda:
            # Sonnet classificou explicitamente como negativo — prevalece mesmo com pct_neg < 50
            analise["sentimento_post"] = "negativo"
        elif sent_coments == "positivo" and analise_profunda:
            analise["sentimento_post"] = "positivo"
        elif sent_coments == "misto" and pct_neg > pct_pos:
            analise["sentimento_post"] = "negativo"
        elif sent_coments == "misto" and pct_pos > pct_neg:
            analise["sentimento_post"] = "positivo"
        elif analise.get("sentimento_post") not in ("positivo", "negativo", "neutro"):
            analise["sentimento_post"] = "neutro"
        # Normaliza tema: valores fora do conjunto permitido → "comunicacao"
        if (analise.get("tema") or "").lower().strip() not in TEMAS_VALIDOS:
            analise["tema"] = "comunicacao"

        # Tom da publicacao: chamada dedicada, que ve APENAS a legenda. Nao sai
        # da triagem nem do Sonnet de proposito — os dois recebem o lado do
        # perfil e os comentarios no prompt, e isso contaminava o tom (ver a
        # nota em CRITERIO_TOM_PUBLICACAO: os posts do Hospital Regional saiam
        # 'favoravel' na conta do governo e 'neutro' no classificador limpo).
        _url_post = (post.get("url") or "").strip()
        if _url_post in tom_gravado:
            _tom, _conf_tom = tom_gravado[_url_post]
        else:
            _tom, _conf_tom = classificar_tom_publicacao(post.get("caption") or "", cliente)
            if _tom != "nao_classificado":
                n_tom_novo += 1
        analise["tom_publicacao"] = _tom
        analise["confianca_tom"] = _conf_tom

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

        # Perfis politicos nao passam pelo classificador de comentarios (so
        # cidadaos passam) e por isso ficam SEM sentimento — 'neutro' aqui quer
        # dizer "nao medido", nao "achou morno".
        #
        # Antes eles herdavam o sentimento agregado do post. Isso fabricava
        # opiniao: um perfil politico que so escreveu "👏👏" era gravado como
        # negativo porque a media do post era negativa, e esse valor herdado
        # voltava para dentro da media na reagregacao — a media alimentando a
        # si mesma. O clima mede a populacao, e assessoria e vereador nao sao a
        # populacao: ficam de fora da conta (ver recalcular_sentimento_posts).
        for c in comentarios:
            if c["tipo"] != "cidadao" and not c.get("sentimento"):
                c["sentimento"] = "neutro"

        modo = "PROFUNDO" if analise_profunda else "rapido"
        log(f"    img={analise.get('score_imagem',50)} risco={_sc} [{modo}] "
            f"{classificados}/{len(cidadaos_lista)} coments classificados")
        time.sleep(1)

    log(f"  {len(resultado)} posts: {n_profundo} profundo (Sonnet), {n_rapido} rapido (Haiku), "
        f"{n_tom_novo} tom novo ({len(resultado) - n_tom_novo} reaproveitados)")
    return resultado

# ==============================================================
# MODULO SCCT - RECOMENDACAO DE ABORDAGEM E OVERRIDE DE ALERTA
# ==============================================================
# Baseado em: SCCT (Coombs) + Image Repair Theory (Benoit).
# A ABORDAGEM (qual estrategia) e deterministica — depende so do cluster,
# nao do humor do modelo. O Claude preenche o cluster; a regra fixa recomenda.

# Texto EXIBIDO (vai para boletins e chega à tela), então vai acentuado e sem
# travessão — ao contrário dos prompts, que são instrução para o modelo. Antes
# estes quatro textos eram gravados sem acento e apareciam assim no painel.
ABORDAGEM_POR_CLUSTER = {
    "vitima": {
        "abordagem": "Esclarecer com evidência factual (negação factual + ação corretiva)",
        "por_que": "A gestão é vítima do episódio. Confrontar rápido com fato funciona melhor que o silêncio: boato não confrontado vira verdade percebida.",
    },
    "acidental": {
        "abordagem": "Corrigir e contextualizar (ação corretiva + redução da ofensa)",
        "por_que": "Erro não intencional. Mostrar a correção e o contexto preserva mais a imagem do que negar: negar soa como arrogância.",
    },
    "intencional": {
        "abordagem": "Reconhecer e apresentar plano (mortificação + ação corretiva)",
        "por_que": "O público atribui alta responsabilidade. Reconhecer e mostrar plano reduz o dano; negar ou minimizar amplia a crise.",
    },
    "nenhum": {
        "abordagem": "Nenhuma ação reativa: monitorar",
        "por_que": "Conteúdo neutro ou positivo. Se for positivo relevante, vale amplificar nos canais próprios.",
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
    """Explica em texto por que o post disparou alerta (Supabase + WhatsApp)."""
    if score_risco >= SCORE_RISCO_ALERTA:
        return f"Score risco {score_risco} >= {SCORE_RISCO_ALERTA}"
    tracao = "tendencia em alta" if post.get("tendencia") == "crescendo" else "engajamento alto"
    return (f"Override SCCT — crise {post.get('cluster_crise', '')}, "
            f"responsabilidade {post.get('responsabilidade_atribuida', '?')}/100, "
            f"{tracao} (score {score_risco})")


# ==============================================================
# MODULO 5 - GRAVACAO NO SUPABASE
# ==============================================================
# (Ate 01/08/2026 o modulo 5 gravava no Google Sheets e este bloco era o
#  "5c - dual-write". O Sheets saiu do fluxo; o Supabase, que ja era a
#  fonte do dashboard, virou o unico destino.)

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


def _registrar_coleta(platform, data_type, items_count, status="ok", source_id=None):
    """Registra o resumo de uma etapa de coleta em collection_logs, p/ a aba
    Monitor de Coleta do Radar Comando. Best-effort: nunca derruba o pipeline.
    source_id fica None no Instagram (as fontes vivem em monitored_sources, não
    na tabela `sources` do subsistema novo — a coluna aceita null)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    url = f"{SUPABASE_URL}/rest/v1/collection_logs"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
               "Content-Type": "application/json", "Prefer": "return=minimal"}
    payload = [{"source_id": source_id, "platform": platform, "data_type": data_type,
                "items_count": int(items_count or 0), "status": status}]
    try:
        requests.post(url, headers=headers, json=payload, timeout=15)
    except Exception as e:
        log(f"    collection_logs: erro {e}")


def recalcular_sentimento_posts(dry_run=False):
    """
    Recalcula os agregados de sentimento POR POST (comentarios_pct_pos,
    comentarios_pct_neg e sentimento_comentarios) a partir da tabela `comments`
    — a fonte da verdade, classificada por comentario.

    Corrige o dessync que zerava o "% criticaram" no dashboard: os posts ficaram
    congelados (agregado no fallback 0/0/neutro) enquanto os comentarios seguem
    sendo classificados. Aqui a gente reprojeta o agregado a partir dos
    comentarios reais.

    Custo ZERO de creditos: nao chama Apify nem Anthropic — so reagrega dados
    que ja estao no Supabase. NAO toca em sentimento_post, so nos campos de
    comentario.

    Percentuais sao sobre o TOTAL de comentarios de CIDADAOS do post (neutro
    entra na base, como o resto do app assume: pos + neg + neutro = 100).

    Duas correcoes de 25/07, para o numero refletir a populacao de verdade:

    1. So entram comentarios de CIDADAO. Perfis politicos (assessoria, vereador,
       outro portal) nao passam pelo classificador e antes herdavam o sentimento
       medio do post — a media alimentando a si mesma. Alem disso, o painel diz
       "comentarios analisados" da POPULACAO: politico nao e populacao.

    2. Comentario que o proprio classificador marcou com confianca < 50 nao
       conta como critica nem como elogio. O modelo declarou que nao conseguiu
       decidir (ironia, giria, texto curto); somar isso como certeza inflava o
       lado mais numeroso. Ele continua no total, como indeterminado.
    """
    from urllib.parse import quote
    from collections import defaultdict

    if not SUPABASE_URL or not SUPABASE_KEY:
        log("[recalc-sentimento] SUPABASE ausente — abortando.")
        return

    log(f"[recalc-sentimento] tenant={TENANT} dry_run={dry_run}")

    # 1) Puxa todos os comentarios (paginando — PostgREST corta em 1000/req).
    comments = []
    page = 0
    while True:
        chunk = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&tipo=eq.cidadao"
            f"&select=url_post,sentimento,confianca_tema&limit=1000&offset={page * 1000}",
        )
        if not chunk:
            break
        comments.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
    log(f"[recalc-sentimento] {len(comments)} comentarios carregados")
    if not comments:
        log("[recalc-sentimento] nada a fazer.")
        return

    # 2) Agrega por url_post.
    agg = defaultdict(lambda: {"pos": 0, "neg": 0, "neu": 0, "tot": 0, "incerto": 0})
    for c in comments:
        u = (c.get("url_post") or "").strip()
        if not u:
            continue
        s = (c.get("sentimento") or "neutro").lower()
        a = agg[u]
        a["tot"] += 1
        if not _sentimento_confiavel(c):
            # Classificacao que o proprio modelo marcou como incerta: entra no
            # total como indeterminado, nunca como critica nem como elogio.
            a["neu"] += 1
            a["incerto"] += 1
        elif s == "negativo":
            a["neg"] += 1
        elif s == "positivo":
            a["pos"] += 1
        else:
            a["neu"] += 1

    # 3) Para cada post, calcula pct + sentimento_comentarios e grava (PATCH).
    n_atualizados = 0
    for url, a in sorted(agg.items(), key=lambda kv: -kv[1]["tot"]):
        tot = a["tot"] or 1
        pct_pos = round(a["pos"] / tot * 100)
        pct_neg = round(a["neg"] / tot * 100)
        # Limiar unico para os dois lados (antes: 50 p/ negativo, 60 p/ positivo,
        # e empate caia no lado negativo). Assimetria aqui virava vies no clima.
        if a["neg"] == 0 and a["pos"] == 0:
            sent = "neutro"
        elif pct_neg > pct_pos:
            sent = "negativo" if pct_neg >= 50 else "misto"
        elif pct_pos > pct_neg:
            sent = "positivo" if pct_pos >= 50 else "misto"
        else:
            sent = "misto"

        payload = {
            "comentarios_pct_pos": pct_pos,
            "comentarios_pct_neg": pct_neg,
            "sentimento_comentarios": sent,
        }

        if dry_run:
            if pct_pos or pct_neg:
                log(f"  …{url[-18:]}: {a['tot']:>3}c  +{pct_pos:>3}% / -{pct_neg:>3}%  [{sent}]")
            continue

        filtro = f"tenant=eq.{TENANT}&url=eq.{quote(url, safe='')}"
        if _supabase_patch("posts", filtro, payload):
            n_atualizados += 1

    log(f"[recalc-sentimento] {'(dry-run) ' if dry_run else ''}"
        f"posts com comentarios: {len(agg)}, atualizados: {n_atualizados}")


def reparar_sentimento_oposicao(dry_run=False):
    """Reclassifica comentarios de cidadao gravados 'positivo' em posts de
    perfis de OPOSICAO — o unico jeito de "elogio a gestao vindo de post de
    oposicao" acontecer de verdade e defender a gestao de uma critica; simples
    apoio ao opositor e NEUTRO (PROMPT_COMENTARIOS, regra 1).

    POR QUE ISTO EXISTE (achado em 30/07): a chamada de `analisar_comentarios_
    haiku` nunca fixava `temperature`, rodando no default da API (1.0). Num
    comentario limitrofe ("Vereador vc falou tudo", num post do vereador
    opositor sobre o Hospital Dantas Bião) a MESMA entrada, o MESMO prompt,
    saiu positivo na producao e neutro em 4 de 4 repeticoes com temperature=0
    — nao era a regra que estava errada, era a amostragem. A chamada ja leva
    temperature=0 (ver analisar_comentarios_haiku); esta funcao conserta o que
    ja foi gravado com o comportamento antigo.

    Reclassifica o POST INTEIRO (todos os comentarios de cidadao do post, no
    mesmo lote e ordem que a producao usaria), nao so a linha suspeita: rodar
    o mesmo texto por um caminho diferente do de producao seria uma segunda
    forma de classificar o mesmo dado. So GRAVA sentimento e confianca_tema, e
    so quando o valor novo diverge do gravado.

    `--reparar-sentimento-oposicao --dry-run` -> mostra o que mudaria; CHAMA o
        modelo (Haiku, temperature=0) mas nao grava nada — e o unico jeito de
        prever o resultado, porque a decisao depende do modelo, nao so do texto.
    `--reparar-sentimento-oposicao`           -> grava, e recalcula os agregados
        dos posts afetados (comentarios_pct_pos/neg) em seguida.

    Custo: so Anthropic (Haiku), escopado aos posts que hoje tem pelo menos um
    comentario suspeito — nao varre a base inteira.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("[reparar-sentimento-oposicao] SUPABASE ausente.")
        return
    if not ANTHROPIC_KEY:
        log("[reparar-sentimento-oposicao] ANTHROPIC_API_KEY ausente.")
        return
    from urllib.parse import quote

    suspeitos = _supabase_get(
        "comments",
        f"tenant=eq.{TENANT}&tipo=eq.cidadao&categoria_post=eq.Oposicao"
        f"&sentimento=eq.positivo&select=url_post&limit=2000",
    ) or []
    urls = sorted({c["url_post"] for c in suspeitos if c.get("url_post")})
    if not urls:
        log("[reparar-sentimento-oposicao] Nenhum comentario positivo em post de oposicao.")
        return
    log(f"[reparar-sentimento-oposicao] {len(suspeitos)} comentario(s) suspeito(s) "
        f"em {len(urls)} post(s). Reclassificando cada post inteiro…")

    cliente = _cliente_anthropic()
    mudancas = []
    for url in urls:
        posts = _supabase_get(
            "posts",
            f"tenant=eq.{TENANT}&url=eq.{quote(url, safe='')}&select=url,autor,categoria,caption",
        )
        if not posts:
            continue
        post = posts[0]
        coments = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&tipo=eq.cidadao&url_post=eq.{quote(url, safe='')}"
            f"&select=id,username,texto,curtidas,sentimento,confianca_tema"
            f"&order=curtidas.desc&limit=200",
        ) or []
        coments = [c for c in coments if (c.get("texto") or "").strip()]
        if not coments:
            continue

        analise_por_i = analisar_comentarios_haiku(post, coments, cliente)
        for idx, c in enumerate(coments):
            item = analise_por_i.get(idx)
            if not item:
                continue
            novo_sent = item.get("sentimento")
            if novo_sent not in ("positivo", "negativo", "neutro"):
                continue
            try:
                nova_conf = int(item.get("confianca_tema") or 0)
            except (TypeError, ValueError):
                nova_conf = 0
            antigo_sent = (c.get("sentimento") or "neutro").lower()
            if novo_sent != antigo_sent:
                mudancas.append({
                    "id": c["id"], "autor": post.get("autor", ""),
                    "antes": antigo_sent, "depois": novo_sent,
                    "conf_antes": c.get("confianca_tema"), "conf_depois": nova_conf,
                    "texto": c.get("texto", ""),
                })

    if not mudancas:
        log("[reparar-sentimento-oposicao] Reclassificado, e nada mudou — "
            "os comentarios suspeitos ja bateriam com o criterio atual.")
        return

    log(f"\n[reparar-sentimento-oposicao] {len(mudancas)} comentario(s) mudariam:\n")
    for m in mudancas:
        t = " ".join(m["texto"].split())[:120]
        log(f"  @{m['autor']:<20} {m['antes']:>8} -> {m['depois']:<8} "
            f"[conf {m['conf_antes']} -> {m['conf_depois']}] {t!r}")

    if dry_run:
        log("\n[reparar-sentimento-oposicao] --dry-run: nada gravado.")
        return

    gravados = 0
    for m in mudancas:
        if _supabase_patch(
            "comments", f"id=eq.{m['id']}&tenant=eq.{TENANT}",
            {"sentimento": m["depois"], "confianca_tema": m["conf_depois"]},
        ):
            gravados += 1
    log(f"\n[reparar-sentimento-oposicao] {gravados}/{len(mudancas)} gravados.")
    recalcular_sentimento_posts(dry_run=False)


def expurgar_pii(dias=None, dry_run=False):
    """Apaga o texto bruto e o @ do autor dos comentarios que passaram da janela
    de retencao, preservando tudo que os indices precisam.

    POR QUE ISTO EXISTE (auditoria de 26/07): o autor_hash era gravado na MESMA
    linha que o `username` e o `texto` em claro. A pseudonimizacao nao separava
    identidade de conteudo, ficava ao lado dela, e portanto nao protegia nada.
    Somado a isso, nada nunca era apagado: o banco acumulava indefinidamente
    opiniao politica de cidadao identificado, que a LGPD classifica como dado
    pessoal SENSIVEL (art. 5o, II), sob controle de um orgao publico.

    Depois do expurgo a linha historica fica so com o hash, que e o que ele
    sempre prometeu ser. O que SOBREVIVE (e o que alimenta clima, indices,
    Pedidos, Bairros e a serie historica):
        sentimento, tema, subtema, localidade, pedido, curtidas,
        confianca_tema, autor_hash, datas
    O que e APAGADO: texto, username.

    Cobre tambem as linhas sem `data_comentario_dia` (falha de parse do fuso),
    usando `atualizado_em` — senao elas ficariam fora da retencao para sempre.

    Custo ZERO: nao chama Apify nem Anthropic, so escreve no Supabase.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("[expurgo-pii] SUPABASE ausente — abortando.")
        return 0

    dias = int(dias if dias is not None else RETENCAO_PII_DIAS)
    corte_dia = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    corte_iso = (datetime.now() - timedelta(days=dias)).isoformat()
    log(f"[expurgo-pii] tenant={TENANT} retencao={dias}d corte={corte_dia} dry_run={dry_run}")

    # Dois recortes: pelo dia do comentario e, para quem nao tem dia parseado,
    # pela data de atualizacao da linha.
    recortes = [
        ("por data do comentario", f"data_comentario_dia=lt.{corte_dia}"),
        ("sem data (fallback)",    f"data_comentario_dia=is.null&atualizado_em=lt.{corte_iso}"),
    ]

    total = 0
    for rotulo, recorte in recortes:
        base = f"tenant=eq.{TENANT}&{recorte}&pii_expurgado_em=is.null"

        # Conta paginando (PostgREST corta em 1000/req).
        n, page = 0, 0
        while True:
            chunk = _supabase_get("comments", f"{base}&select=id&limit=1000&offset={page * 1000}")
            if not chunk:
                break
            n += len(chunk)
            if len(chunk) < 1000:
                break
            page += 1

        if not n:
            log(f"  {rotulo}: nada a expurgar")
            continue
        if dry_run:
            log(f"  {rotulo}: {n} comentarios seriam expurgados")
            total += n
            continue

        ok = _supabase_patch("comments", base, {
            "texto": "",
            "username": "",
            "pii_expurgado_em": datetime.now().isoformat(),
        })
        if ok:
            log(f"  {rotulo}: {n} comentarios expurgados")
            total += n
        else:
            log(f"  {rotulo}: FALHOU o PATCH de {n} comentarios")

    log(f"[expurgo-pii] {'(dry-run) ' if dry_run else ''}total: {total}")
    return total


def gravar_no_supabase(posts_analisados, comentarios_por_post):
    """Grava posts e comentarios no Postgres do Supabase (destino unico)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("  Supabase OFF — dashboard NAO sera atualizado")
        return
    log("=== MODULO 5 - Gravando no Supabase ===")
    agora = datetime.now().isoformat()

    # Tom ja gravado, por URL. O pipeline reprocessa os mesmos posts a cada
    # execucao (a janela retroativa se sobrepoe), entao um upsert que mandasse
    # 'nao_classificado' porque a triagem falhou naquela rodada apagaria uma
    # classificacao boa da rodada anterior. Aqui o valor antigo e preservado:
    # so sobrescreve quem chegou classificado de verdade.
    tom_atual = {}
    for _r in _supabase_get(
        "posts", f"tenant=eq.{TENANT}&select=url,tom_publicacao,confianca_tom&limit=5000"
    ) or []:
        tom_atual[(_r.get("url") or "").strip()] = (
            _r.get("tom_publicacao") or "nao_classificado",
            int(_r.get("confianca_tom") or 0),
        )

    posts_rows = []
    for p in posts_analisados:
        if not p.get("url"):
            continue
        _ppos = float(p.get("comentarios_pct_pos", 0) or 0)
        _pneg = float(p.get("comentarios_pct_neg", 0) or 0)
        if _ppos + _pneg > 100:
            _tot = _ppos + _pneg
            _ppos, _pneg = _ppos / _tot * 100, _pneg / _tot * 100
        _tom = p.get("tom_publicacao") or "nao_classificado"
        _conf_tom = int(p.get("confianca_tom", 0) or 0)
        if _tom == "nao_classificado":
            _tom, _conf_tom = tom_atual.get((p.get("url") or "").strip(),
                                            ("nao_classificado", 0))
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
            # Tom da PUBLICACAO (o que o perfil disse) — separado do
            # sentimento_post, que e a REACAO. Migration 010.
            "tom_publicacao": _tom,
            "confianca_tom": _conf_tom,
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

# Pesos do risco politico. Espelham DEFAULT_SCORE_WEIGHTS de
# radar-app/src/lib/indices.ts: os dois lados precisam calcular o MESMO numero
# a partir das MESMAS entradas. Se mexer aqui, mexer la.
PESO_RISCO_IAD        = 0.35
PESO_RISCO_PCT_ALTO   = 0.25
PESO_RISCO_VELOCIDADE = 0.20
PESO_RISCO_ICA        = 0.05
_SOMA_PESOS_RISCO = (PESO_RISCO_IAD + PESO_RISCO_PCT_ALTO
                     + PESO_RISCO_VELOCIDADE + PESO_RISCO_ICA)


def calc_risco(posts, iad, ica, neg_velocity=0.0):
    """Risco politico (0-100) + nivel de crise.

    NORMALIZADO pela soma dos pesos aplicados (auditoria de 26/07).

    Antes os pesos somavam 0,65 e o resultado era apresentado numa escala que
    diz ir de 0 a 100. O teto real era 65, e as faixas de boletim.py
    ("tempo fechando" >= 60, "tempestade" >= 80) eram inalcancaveis: numa
    varredura das 9.261 combinacoes possiveis de (iad, pct_alto, ica), 69,7%
    caiam em "ceu limpo", 1% chegava a "tempo fechando" e "tempestade" tinha
    probabilidade ZERO. Um cenario de aprovacao 5 com 90% dos posts em risco
    alto devolvia 58,8 e era exibido como "nuvens isoladas".

    Dividir pela soma dos pesos faz a escala usar de fato os 0-100 que ela
    declara ter, sem mexer nas faixas nem no significado das palavras.

    O termo de amplificacao ficou de fora da conta (numerador E denominador):
    era multiplicado por zero desde sempre, porque o dado nao e coletado.
    Mante-lo no denominador so reintroduziria o mesmo teto artificial, agora
    disfarcado. Quando o dado existir, ele entra aqui e no indices.ts juntos.
    """
    tot = len(posts) or 1
    pctRiscoAlto = sum(1 for p in posts if str(p.get("risco_crise", "")).strip().lower() == "alto") / tot * 100
    # Velocidade do negativo AMORTECIDA pela confianca da amostra: com amostra
    # fraca, um pico de % negativo num dia nao dispara o risco.
    velTerm = max(0.0, min(100.0, neg_velocity * 4)) * (ica / 100)
    risco = max(0.0, min(100.0, (
        PESO_RISCO_IAD * (100 - iad)
        + PESO_RISCO_PCT_ALTO * pctRiscoAlto
        + PESO_RISCO_VELOCIDADE * velTerm
        + PESO_RISCO_ICA * (100 - ica)
    ) / _SOMA_PESOS_RISCO))
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

    # Velocidade do negativo: MESMA definicao do frontend (CommandCenter.tsx),
    # pct_neg do dia menos o de 3 entradas atras na serie de dias com posts.
    # Sem isso o backend calcularia o risco com 3 termos e o frontend com 4,
    # e o mesmo dia teria dois riscos diferentes no mesmo produto.
    pct_neg_por_dia = {}
    for r in (_supabase_get(
        "daily_metrics",
        f"tenant=eq.{TENANT}&select=dia,pct_neg&order=dia.desc&limit=30") or []):
        if r.get("dia"):
            pct_neg_por_dia[r["dia"]] = float(r.get("pct_neg") or 0)
    for dia, ps in by_day.items():
        t = len(ps) or 1
        pct_neg_por_dia[dia] = sum(1 for p in ps if _sent(p) == "negativo") / t * 100
    dias_ordenados = sorted(pct_neg_por_dia)
    idx_do_dia = {d: i for i, d in enumerate(dias_ordenados)}

    def _velocidade(dia):
        i = idx_do_dia.get(dia, 0)
        if i < 3:
            return 0.0
        return pct_neg_por_dia[dia] - pct_neg_por_dia[dias_ordenados[i - 3]]

    rows = []
    for dia, ps in by_day.items():
        iad = calc_iad(ps)
        ica = calc_ica(ps)
        risco, nivel = calc_risco(ps, iad, ica, _velocidade(dia))
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
Gustavo Carmo (Alagoinhas/BA). Recebe o retrato digital do periodo (dia, semana ou
mes) e produz um briefing ACIONAVEL para o gabinete. Seja concreto, direto e pratico — nada de generico.
Responda APENAS com JSON valido, sem markdown.

REGRA DE NUMEROS (CRITICA): o campo "diagnostico" NUNCA pode conter valores
numericos — nada de IAD, risco, percentuais, contagens de posts ou comentarios.
Descreva a imagem em linguagem QUALITATIVA: use as palavras do nivel ("risco baixo",
"risco moderado", "risco alto") e descreva a proporcao em texto ("maioria dos
comentarios critica", "leve saldo negativo", "elogios isolados"). Os numeros aparecem
nos paineis do dashboard; sua funcao e INTERPRETA-LOS em palavras, nunca repeti-los.
Exemplos do que NAO escrever: "IAD 52", "risco 21", "43% negativos", "29% positivos",
"13 posts". Exemplos do que escrever: "imagem em risco baixo", "saldo negativo
relevante", "a maioria dos comentarios do dia foi critica".

REGRA DE ESTILO: NUNCA use travessao (o caractere — ou –) em nenhum texto gerado.
Separe ideias com virgula, dois-pontos ou parenteses. Todo texto gerado (diagnostico,
alertas, oportunidades, recomendacoes) deve estar em portugues do Brasil correto, com
acentuacao e ortografia certas: escreva "saúde pública", "gestão", "crítica", nunca
"saude publica", "gestao", "critica". As instrucoes deste prompt estao sem acento;
NAO imite esse estilo na resposta."""

# Salvaguarda: detecta numeros-metrica cravados no diagnostico (IAD, risco, %,
# contagens de posts/comentarios) que deveriam viver so nos cards do dashboard.
# Nao casa valores factuais como "R$160 mil" (fato de denuncia, nao metrica).
_PADRAO_NUMERO_DIAGNOSTICO = re.compile(
    r"\bIAD\b\s*\d|\brisco\b\s*\d|\d+\s*%|\d+\s*(?:posts?|coment)",
    re.IGNORECASE,
)

_ROTULO_PERIODO = {"dia": "DIA", "semana": "SEMANA", "mes": "MES"}
_FRASE_PERIODO = {"dia": "no dia", "semana": "na semana", "mes": "no mes"}
_DIAS_PERIODO = {"dia": 1, "semana": 7, "mes": 30}

# Um alerta em "temas que merecem atencao" so e legitimo se tiver comentarios
# REAIS de cidadaos por tras — um post isolado de score alto, sem eco na
# populacao, nao e alerta (isso ja e tratado à parte pelo Cacador de Crises).
# Calibrado como o `subtema_limiar` default (3) usado no alerta de volume.
MIN_COMENTARIOS_ALERTA = 3

def contar_comentarios_por_tema(dias):
    """Conta comentarios de cidadaos por categoria fixa (tema) nos ultimos
    `dias` dias — usado pra podar alertas sem volume real (MIN_COMENTARIOS_ALERTA)
    e pra listar o tema dominante de verdade no briefing.

    NAO filtra por `comments.data_comentario_ts`: esse campo e de um backfill
    parcial e so existe em ~8% das linhas (achado em produção — de 1296
    comentarios com tema classificado, so 114 tem esse timestamp). Filtrar por
    ele sub-representa violentamente qualquer janela, e foi a causa raiz de um
    "tema dominante" que nao batia com o grafico do dashboard.

    Em vez disso, usa `posts.data_post` (sempre preenchida) como proxy: busca
    os posts da janela, pega o conjunto de URLs, e conta so os comentarios
    cujo `url_post` esta nesse conjunto — mesmo join por URL que o frontend ja
    usa em lib/data.ts::fetchAgregadoComentarios pra reprojetar sentimento."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}

    posts = _supabase_get("posts", f"tenant=eq.{TENANT}&select=url,data_post&limit=5000") or []
    cutoff = datetime.now() - timedelta(days=dias)
    urls_na_janela = set()
    for p in posts:
        d = _dia_iso(p.get("data_post", ""))
        if not d:
            continue
        try:
            if datetime.strptime(d, "%Y-%m-%d") >= cutoff:
                urls_na_janela.add((p.get("url") or "").strip())
        except ValueError:
            continue
    if not urls_na_janela:
        return {}

    comentarios = _supabase_get(
        "comments",
        f"tenant=eq.{TENANT}&tipo=eq.cidadao&tema=not.is.null&tema=neq.outro"
        f"&select=url_post,tema&limit=8000",
    ) or []
    contagem = {}
    for c in comentarios:
        if (c.get("url_post") or "").strip() not in urls_na_janela:
            continue
        t = (c.get("tema") or "").strip().lower()
        if t:
            contagem[t] = contagem.get(t, 0) + 1
    return contagem


def _gerar_briefing(posts, periodo, dia):
    """Nucleo generico do briefing estrategico: monta o contexto, chama Claude
    e grava em ai_briefings (tenant, dia, periodo). `posts` pode ser tanto os
    posts deste run (periodo='dia') quanto o historico buscado no Supabase
    pra semana/mes (buscar_posts_periodo) — mesma forma, mesmos campos."""
    if not SUPABASE_URL or not SUPABASE_KEY or not posts:
        if not posts:
            return
        log(f"  Briefing IA [{periodo}]: Supabase nao configurado - pulando")
        return
    log(f"=== MODULO 7 - Assistente Estrategico (IA) [{periodo}] ===")

    iad = calc_iad(posts)
    ica = calc_ica(posts)
    risco, nivel = calc_risco(posts, iad, ica)
    tot = len(posts) or 1
    pos = sum(1 for p in posts if _sent(p) == "positivo")
    neg = sum(1 for p in posts if _sent(p) == "negativo")

    queixas, elogios = {}, {}
    for p in posts:
        if p.get("queixa_dominante"): queixas[p["queixa_dominante"]] = queixas.get(p["queixa_dominante"], 0) + 1
        if p.get("elogio_dominante"): elogios[p["elogio_dominante"]] = elogios.get(p["elogio_dominante"], 0) + 1
    top_queixas = sorted(queixas.items(), key=lambda x: -x[1])[:5]
    top_elogios = sorted(elogios.items(), key=lambda x: -x[1])[:3]
    top_posts   = sorted(posts, key=lambda p: int(p.get("score_risco", 0) or 0), reverse=True)[:5]

    # Fonte UNICA do "tema dominante": contagem real por comentario de cidadao
    # (contar_comentarios_por_tema), a MESMA usada no filtro de evidencia dos
    # alertas e no grafico "Volume de comentarios por tema" do frontend. Antes
    # este contexto usava contagem de POSTS (quantos posts tem cada tema),
    # uma metrica diferente que podia divergir do que os cidadaos realmente
    # comentam — achado real: "tema dominante" no diagnostico nao batia com
    # o grafico do dashboard.
    contagem_temas = contar_comentarios_por_tema(_DIAS_PERIODO.get(periodo, 1))
    top_temas = sorted(contagem_temas.items(), key=lambda x: -x[1])[:5]

    rotulo = _ROTULO_PERIODO.get(periodo, "DIA")
    ctx  = f"INDICES DO {rotulo}:\n"
    ctx += f"  Aprovacao Digital (IAD): {iad:.0f}/100\n"
    ctx += f"  Confianca da Amostra (ICA): {ica:.0f}/100\n"
    ctx += f"  Risco Politico: {risco:.0f}/100 (nivel: {nivel})\n"
    ctx += f"  Posts: {tot} | Positivos: {round(pos/tot*100)}% | Negativos: {round(neg/tot*100)}%\n\n"
    if top_temas:
        ctx += ("TEMAS DOMINANTES (por volume real de comentarios de cidadaos, nao por "
                "contagem de posts): " + ", ".join(f"{t} ({n})" for t, n in top_temas) + "\n")
    else:
        ctx += "TEMAS DOMINANTES: nenhum comentario de cidadao classificado por tema ainda neste periodo.\n"
    if top_queixas:
        ctx += "PRINCIPAIS QUEIXAS: " + " | ".join(f"{q} ({n})" for q, n in top_queixas) + "\n"
    if top_elogios:
        ctx += "PRINCIPAIS ELOGIOS: " + " | ".join(f"{e} ({n})" for e, n in top_elogios) + "\n"
    ctx += "\nPOSTS MAIS CRITICOS:\n"
    for p in top_posts:
        ctx += f"  @{p.get('autor','')} ({p.get('categoria','')}) | tema: {p.get('tema','')} | risco: {p.get('score_risco',0)} | {p.get('sentimento_post','')}\n"
        if p.get("comentarios_destaque"):
            ctx += f"     comentario: \"{p.get('comentarios_destaque','')[:160]}\"\n"

    prompt = ctx + f"""
Retorne APENAS este JSON:
{{
  "diagnostico": "<2-3 frases QUALITATIVAS: como esta a imagem {_FRASE_PERIODO.get(periodo, 'no dia')} e por que. PROIBIDO citar numeros (IAD, risco, %, contagens) — descreva tudo em palavras. Ex: 'A imagem está em risco baixo, mas com saldo negativo relevante: a maioria dos comentários do período critica o São João (banda atrasada, contrato sob suspeita e infraestrutura precária). Um perfil fiscal crítico já anunciou cobertura adversária contínua.'>",
  "oportunidades": [{{"titulo":"...","acao":"...","impacto":"alto|medio|baixo","esforco":"alto|medio|baixo"}}],
  "alertas": [{{"nivel":"baixo|moderado|alto|critico","tema":"...","tema_categoria":"<saude|educacao|obras|seguranca|transporte|emprego|impostos|saneamento|cultura_eventos|comunicacao — a categoria fixa mais proxima do assunto do alerta, usada pra puxar os comentarios reais que embasam a conclusao>","janela":"imediato|24h|esta semana"}}],
  "recomendacoes_comunicacao": [{{"canal":"...","mensagem":"...","tom":"...","timing":"..."}}]
}}
IMPORTANTE sobre "alertas": só inclua um tema aqui se ele tiver volume real de
comentários de cidadãos na categoria (ver TEMAS DOMINANTES acima) — no mínimo
{MIN_COMENTARIOS_ALERTA} comentários. Um post isolado de risco alto, sem eco
na população em comentários, NÃO é "tema que merece atenção" — isso já é
tratado à parte (Caçador de Crises). Prefira omitir a colocar um alerta sem
essa base.
Maximo 3 itens por lista. Seja especifico ao contexto de Alagoinhas."""

    try:
        cliente = _cliente_anthropic()
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
        log(f"  Briefing IA [{periodo}]: erro {e}")
        return

    # Salvaguarda: o diagnostico deve ser qualitativo. Se a IA cravou um numero-metrica
    # (IAD, risco, %, contagem), loga para monitoramento — texto e mantido para nao
    # mutilar a frase; o sinal serve para revisar/reforcar o prompt.
    _leak = _PADRAO_NUMERO_DIAGNOSTICO.search(data.get("diagnostico", "") or "")
    if _leak:
        log(f"  ⚠ Briefing [{periodo}]: diagnostico contem numero cravado ('{_leak.group(0).strip()}') "
            f"— deveria ser qualitativo. Texto mantido; revisar PROMPT_BRIEFING.")

    # tema_categoria precisa bater com o vocabulario fixo de comments.tema —
    # e o que o front usa pra buscar os comentarios que embasam o alerta
    # ("Ver comentarios"). Fora do conjunto -> vazio (front so esconde o botao).
    for a in data.get("alertas", []) or []:
        if (a.get("tema_categoria") or "").lower().strip() not in TEMAS_VALIDOS:
            a["tema_categoria"] = ""
        else:
            a["tema_categoria"] = a["tema_categoria"].lower().strip()

    # Rede de seguranca: NAO confia so na instrucao do prompt. Um alerta so
    # sobrevive se tiver volume real de comentarios de cidadaos por tras —
    # senao um post isolado de score alto (ja tratado pelo Cacador de Crises)
    # aparece como "tema que merece atencao" sem sustentacao nenhuma na
    # populacao (achado real: alerta "alto" com 1 unico comentario).
    alertas_com_evidencia = []
    for a in data.get("alertas", []) or []:
        cat = a.get("tema_categoria") or ""
        n = contagem_temas.get(cat, 0) if cat else 0
        if n < MIN_COMENTARIOS_ALERTA:
            log(f"  Alerta descartado (evidencia insuficiente, {n} comentario(s) — "
                f"minimo {MIN_COMENTARIOS_ALERTA}): {str(a.get('tema',''))[:70]}")
            continue
        alertas_com_evidencia.append(a)
    data["alertas"] = alertas_com_evidencia

    row = [{
        "tenant": TENANT, "dia": dia, "periodo": periodo,
        "nivel_crise": nivel, "risco": round(risco, 1),
        "diagnostico": data.get("diagnostico", ""),
        "oportunidades": data.get("oportunidades", []),
        "alertas": data.get("alertas", []),
        "recomendacoes": data.get("recomendacoes_comunicacao", data.get("recomendacoes", [])),
        "gerado_em": datetime.now().isoformat(),
    }]
    n = _supabase_upsert("ai_briefings", row, "tenant,dia,periodo")
    log(f"  Briefing IA [{periodo}] gravado: {n} (nivel {nivel}, {len(data.get('recomendacoes_comunicacao', []))} recomendacoes)")
    return {"nivel": nivel, "risco": round(risco, 1), "iad": round(iad, 1), "ica": round(ica, 1), **data}


def gerar_briefing_estrategico(posts_analisados):
    """Gera o briefing diario com Claude e grava em ai_briefings (periodo='dia')."""
    hoje = datetime.now().strftime("%Y-%m-%d")
    return _gerar_briefing(posts_analisados, "dia", hoje)


def buscar_posts_periodo(dias):
    """Busca o historico real de posts do tenant nos ultimos `dias`, direto do
    Supabase — usado pro briefing semanal/mensal (janela de verdade, nao so os
    posts coletados neste run). `data_post` e TEXT em formato "dd/mm/yyyy"
    (nao um DATE de verdade), entao filtrar/ordenar isso no PostgREST
    compararia strings (errado — "01/12" viria antes de "25/01" mesmo sendo
    depois). Por isso busca sem filtro de data e filtra aqui via _dia_iso,
    que ja sabe parsear esse formato."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    campos = ("tema,score_risco,sentimento_post,comentarios_destaque,"
              "queixa_dominante,elogio_dominante,autor,categoria,"
              "comentarios_total,comentarios_pct_pos,comentarios_pct_neg,"
              "data_post,risco_crise")
    posts = _supabase_get("posts", f"tenant=eq.{TENANT}&select={campos}&limit=5000") or []
    cutoff = datetime.now() - timedelta(days=dias)

    def _dentro_da_janela(p):
        d = _dia_iso(p.get("data_post", ""))
        if not d:
            return False
        try:
            return datetime.strptime(d, "%Y-%m-%d") >= cutoff
        except ValueError:
            return False

    return [p for p in posts if _dentro_da_janela(p)]


def gerar_briefings_periodo():
    """Gera o diagnostico + alertas de semana e mes a partir do historico real
    (nao so os posts deste run). Chamado 1x/dia (guard de horario no main),
    pra nao duplicar custo de IA a toa — semana/mes mudam pouco de manha pra
    tarde no mesmo dia."""
    hoje = datetime.now().strftime("%Y-%m-%d")
    for periodo, dias in (("semana", 7), ("mes", 30)):
        posts = buscar_posts_periodo(dias)
        if not posts:
            log(f"  Briefing IA [{periodo}]: sem historico suficiente ({dias}d) — pulando")
            continue
        _gerar_briefing(posts, periodo, hoje)


# ==============================================================
# REPARO: acentuacao dos textos ja gravados em ai_briefings (06/08/26)
# ==============================================================
# Os prompts passaram a exigir portugues acentuado em 06/08, mas o que ja
# estava gravado (diagnostico, alertas, oportunidades, recomendacoes) veio da
# era em que o modelo imitava o estilo sem acento dos proprios prompts — e,
# com a coleta vazia desde 02/08, o pipeline nao regenera briefing nenhum
# sozinho (main() aborta antes da analise). Este reparo corrige APENAS
# diacriticos e cedilha dos textos gravados; um validador rejeita item a item
# qualquer outra mudanca: removidos os diacriticos, o antes e o depois tem
# que ser IDENTICOS (pontuacao, caixa, numeros, palavras), senao o item volta
# ao original. Idempotente: texto ja acentuado retorna igual e a linha nem e
# regravada.

# Campos de texto livre dentro de cada lista JSONB de ai_briefings. So eles
# vao ao revisor; nivel/tema_categoria/janela/impacto/esforco sao vocabulario
# fixo e nao passam pelo modelo.
_CAMPOS_LIVRES_BRIEFING = {
    "alertas": ("tema",),
    "oportunidades": ("titulo", "acao"),
    "recomendacoes": ("canal", "mensagem", "tom", "timing"),
}

def _sem_diacriticos(texto):
    """Remove acentos/cedilha (NFD sem marcas de combinacao) para comparar."""
    nfd = unicodedata.normalize("NFD", texto or "")
    return "".join(ch for ch in nfd if not unicodedata.combining(ch))

def _acentuar_lote(cliente, textos):
    """Manda uma lista de textos ao Haiku (temp 0) e devolve a lista corrigida.

    Item que voltar com QUALQUER mudanca alem de diacriticos/cedilha e
    substituido pelo original — corrigir demais aqui seria reescrever o dado
    historico, que e pior que exibi-lo sem acento."""
    payload = json.dumps(textos, ensure_ascii=False)
    resp = cliente.messages.create(
        model=MODELO_ANALISTA, max_tokens=4000, temperature=0,
        system=(
            "Voce e um revisor ortografico de portugues do Brasil. Recebe um array "
            "JSON de textos e devolve o MESMO array, na MESMA ordem, corrigindo "
            "APENAS acentuacao e cedilha (ex.: 'gestao'->'gestão', 'saude "
            "publica'->'saúde pública', 'comunicacao'->'comunicação'). Atencao a "
            "classe gramatical: 'critica' so recebe acento como substantivo ou "
            "adjetivo ('a crítica', 'fala crítica'); como verbo de criticar ('a "
            "maioria critica a gestao') fica sem acento. PROIBIDO: trocar, inserir "
            "ou remover palavras; mudar pontuacao, numeros, maiusculas, emojis ou "
            "@mencoes; usar travessao. Responda APENAS o array JSON."
        ),
        messages=[{"role": "user", "content": payload}],
    )
    txt = resp.content[0].text.strip()
    if txt.startswith("```"):
        txt = txt.split("```")[1]
        if txt.startswith("json"):
            txt = txt[4:]
    corrigidos = json.loads(txt.strip())
    if not isinstance(corrigidos, list) or len(corrigidos) != len(textos):
        return textos
    finais = []
    for antes, depois in zip(textos, corrigidos):
        ok = isinstance(depois, str) and _sem_diacriticos(depois) == _sem_diacriticos(antes)
        finais.append(depois if ok else antes)
    return finais

def reparar_acentos_briefings(dry_run=False, limite=0):
    """Acentua os textos das linhas de ai_briefings. `limite` 0 = todas.

    Regrava apenas o que mudou, pela mesma chave de upsert da producao
    (tenant,dia,periodo) e so com as colunas de texto — nivel, risco e
    gerado_em ficam como estao."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("Supabase nao configurado — nada a reparar")
        return 0
    params = (f"tenant=eq.{TENANT}&select=dia,periodo,diagnostico,alertas,"
              f"oportunidades,recomendacoes&order=dia.desc,periodo")
    if limite:
        params += f"&limit={int(limite)}"
    linhas = _supabase_get("ai_briefings", params)
    log(f"=== REPARO DE ACENTOS: {len(linhas)} briefing(s) de {TENANT} ===")
    cliente = _cliente_anthropic()
    gravadas = 0
    for row in linhas:
        rotulo = f"[{row.get('periodo')} {row.get('dia')}]"
        # Achata todos os textos livres da linha numa lista so (1 chamada por
        # linha), guardando onde cada um volta.
        textos, destinos = [], []
        diag = row.get("diagnostico") or ""
        if diag.strip():
            textos.append(diag)
            destinos.append(("diagnostico", None, None))
        for lista, campos in _CAMPOS_LIVRES_BRIEFING.items():
            for i, item in enumerate(row.get(lista) or []):
                for campo in campos:
                    valor = (item or {}).get(campo)
                    if isinstance(valor, str) and valor.strip():
                        textos.append(valor)
                        destinos.append((lista, i, campo))
        if not textos:
            continue
        try:
            corrigidos = _acentuar_lote(cliente, textos)
        except Exception as e:
            log(f"  {rotulo} erro na correcao ({e}) — linha mantida")
            continue
        if corrigidos == textos:
            log(f"  {rotulo} ja estava correto — nada a fazer")
            continue
        novo = {
            "diagnostico": diag,
            "alertas": [dict(a or {}) for a in (row.get("alertas") or [])],
            "oportunidades": [dict(o or {}) for o in (row.get("oportunidades") or [])],
            "recomendacoes": [dict(r or {}) for r in (row.get("recomendacoes") or [])],
        }
        n_mudou = 0
        for (lista, i, campo), antes, depois in zip(destinos, textos, corrigidos):
            if depois == antes:
                continue
            n_mudou += 1
            if lista == "diagnostico":
                novo["diagnostico"] = depois
            else:
                novo[lista][i][campo] = depois
        log(f"  {rotulo} {n_mudou} texto(s) corrigido(s)"
            + (f"\n    antes:  {textos[0][:110]}\n    depois: {corrigidos[0][:110]}"
               if corrigidos[0] != textos[0] else ""))
        if dry_run:
            continue
        n = _supabase_upsert("ai_briefings", [{
            "tenant": TENANT, "dia": row.get("dia"), "periodo": row.get("periodo"),
            **novo,
        }], "tenant,dia,periodo")
        gravadas += n
    log(f"Reparo de acentos: {gravadas} linha(s) regravada(s)"
        + (" (dry-run: nada gravado)" if dry_run else ""))
    return gravadas


# ==============================================================
# AGENTE: CAÇADOR DE CRISES (multi-agente, Fase B)
# ==============================================================

PROMPT_CACADOR = """Voce e o CAÇADOR DE CRISES, agente especializado em gestao de crises de
imagem do prefeito Gustavo Carmo (Alagoinhas/BA). Recebe um post sinalizado como ALTO RISCO
e decide, com frieza tatica, se e crise real e o que fazer.

Sua missao NAO e alarmar — e separar ruido de crise verdadeira e dar um plano acionavel.
Considere o historico de risco: risco subindo + comentarios organizados = crise real.
Reclamacao isolada, mesmo agressiva, raramente e crise.

NUNCA use travessao (— ou –) nos textos gerados; use virgula, dois-pontos ou parenteses.
Todo texto gerado deve estar em portugues do Brasil correto, com acentuacao e ortografia
certas: escreva "saúde pública", "gestão", "crítica", nunca "saude publica", "gestao",
"critica". As instrucoes deste prompt estao sem acento; NAO imite esse estilo na resposta.
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
    cliente = _cliente_anthropic()
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

def _auto_dispatch_ativo():
    """Kill-switch do disparo AUTOMATICO de alertas WhatsApp (reuniao de 24/07:
    o envio ao secretario passa a ser SO manual, pelo card "Alertar Secretario"
    do dashboard — menos superficie para alucinacao). A deteccao continua
    rodando (temas alertados alimentam o laco IRT e os paineis); apenas o
    envio externo e suprimido. Religavel por tenant via
    tenant_settings.notification_config.auto_dispatch_whatsapp = true."""
    return bool(_nc.get("auto_dispatch_whatsapp", False))


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

    if not _auto_dispatch_ativo():
        log(f"  verificar_alertas: {len(alertas)} gatilho(s) detectado(s), mas o disparo "
            "automatico esta desativado — envio so manual pelo dashboard")
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


# Nomes legiveis dos subtemas para o texto do alerta (fallback: slug com espacos).
_SUBTEMA_LABEL = {
    "buracos": "buracos", "pavimentacao": "pavimentacao", "drenagem": "drenagem",
    "iluminacao_publica": "iluminacao publica", "obra_parada": "obra parada",
    "ubs_postos": "UBS/postos", "filas_agendamento": "filas e agendamento",
    "medicamentos": "medicamentos", "abastecimento_agua": "falta d'agua",
    "esgoto": "esgoto", "coleta_lixo": "coleta de lixo", "onibus": "onibus",
    "transporte_escolar": "transporte escolar", "merenda": "merenda",
    "professores": "professores", "iptu": "IPTU",
}
def _label_subtema(tema: str, subtema: str) -> str:
    nome = _SUBTEMA_LABEL.get(subtema) or (subtema or "").replace("_", " ")
    return f"{nome} ({tema})" if tema and tema != "outro" else nome


def verificar_alerta_subtema(dry_run: bool = False):
    """Alerta por VOLUME DE SUBTEMA (a 'sensacao popular' do brief de 03/07):
    quando o mesmo subtema aparece em N+ comentarios de cidadaos numa janela de
    24h, dispara — independente do score de risco de cada post individual.

    Exige >=2 autores distintos para nao disparar por uma unica pessoa repetindo.
    Default DESLIGADO (subtema_ativo=False na aba Notificacoes) por ser um canal
    de WhatsApp novo. `dry_run=True` (CLI --teste-subtema) apenas imprime o que
    dispararia, sem enviar nada nem gravar historico."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    if not SUBTEMA_ALERTA_ATIVO and not dry_run:
        return
    if not dry_run and not _auto_dispatch_ativo():
        log("  alerta_subtema: disparo automatico desativado — envio so manual pelo dashboard")
        return
    if not dry_run and (not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER):
        return

    limiar = max(2, int(SUBTEMA_LIMIAR_ALERTA or 3))
    desde = (datetime.utcnow() - timedelta(hours=24)).isoformat()

    # Throttle proprio (tipo distinto de 'auto' p/ nao colidir com verificar_alertas).
    if not dry_run:
        try:
            limite_6h = (datetime.utcnow() - timedelta(hours=6)).isoformat()
            recentes = _supabase_get(
                "alerta_historico",
                f"tenant_id=eq.{TENANT}&tipo=eq.auto_subtema&canal=eq.whatsapp"
                f"&criado_em=gte.{limite_6h}&select=id&limit=1"
            )
            if recentes:
                log("  alerta_subtema: ja enviado nas ultimas 6h — pulando")
                return
        except Exception:
            pass

    rows = _supabase_get(
        "comments",
        f"tenant=eq.{TENANT}&tipo=eq.cidadao&subtema=neq.outro&subtema=not.is.null"
        f"&data_comentario_ts=gte.{desde}"
        f"&select=tema,subtema,sentimento,username&limit=8000"
    ) or []

    grupos = {}
    for c in rows:
        sub = (c.get("subtema") or "").strip()
        if not sub or sub == "outro":
            continue
        tema = (c.get("tema") or "outro").strip()
        g = grupos.setdefault((tema, sub), {"total": 0, "neg": 0, "autores": set()})
        g["total"] += 1
        if (c.get("sentimento") or "").lower() == "negativo":
            g["neg"] += 1
        if c.get("username"):
            g["autores"].add(c["username"].strip().lower())

    disparos = []
    for (tema, sub), g in grupos.items():
        if g["total"] >= limiar and len(g["autores"]) >= 2:
            pneg = round(g["neg"] / g["total"] * 100) if g["total"] else 0
            disparos.append({"tema": tema, "subtema": sub, "total": g["total"],
                             "autores": len(g["autores"]), "pneg": pneg})
    disparos.sort(key=lambda d: (-d["total"], -d["pneg"]))

    if not disparos:
        log(f"  alerta_subtema: nenhum subtema com {limiar}+ comentarios (2+ autores) em 24h")
        return

    linhas = [
        f"📌 *{_label_subtema(d['tema'], d['subtema'])}*: {d['total']} comentarios "
        f"de {d['autores']} pessoas nas ultimas 24h ({d['pneg']}% negativos)"
        for d in disparos[:5]
    ]
    data_hoje = datetime.now().strftime("%d/%m/%Y %H:%M")
    mensagem = (f"*📈 Radar Politico — Assuntos em alta ({data_hoje})*\n\n"
                + "\n".join(linhas)
                + f"\n\n_Assunto repetido por varias pessoas = pauta, nao voz isolada. "
                  f"Limiar: {limiar} comentarios/24h._")

    if dry_run:
        log(f"  [DRY-RUN] alerta_subtema dispararia com {len(disparos)} subtema(s):")
        for l in linhas:
            log("    " + l.replace("*", ""))
        return

    if _enviar_whatsapp(mensagem):
        log(f"  alerta_subtema: WhatsApp enviado ({len(disparos)} subtema(s))")
        _supabase_upsert("alerta_historico", [{
            "tenant_id": TENANT, "tipo": "auto_subtema",
            "valor": disparos[0]["total"],
            "mensagem": " | ".join(l.replace("*", "") for l in linhas),
            "canal": "whatsapp", "criado_em": datetime.now().isoformat(),
        }], "id")
    else:
        log("  alerta_subtema: WhatsApp falhou (ver log acima)")


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
# MODULO 8b - SEGUIDORES (snapshot por perfil monitorado)
# ==============================================================

ACTOR_PERFIS = "apify~instagram-profile-scraper"


def _seguidores_via_instagrapi(handles):
    """Via gratuita. Retorna lista normalizada ou [] se indisponivel/falhou."""
    if not _INSTAGRAPI_OK:
        return []
    try:
        return _ig.coletar_perfis(handles)
    except Exception as e:
        log(f"  Instagrapi (perfis) falhou: {e}")
        return []


def _seguidores_via_apify(handles):
    """Fallback pago. Um unico run com todos os handles — 1 resultado por
    perfil, entao o custo e ~1/10 do scraper de posts por execucao."""
    if not APIFY_TOKEN:
        return []
    try:
        run_id = apify_iniciar_run(ACTOR_PERFIS, {"usernames": handles})
        if not run_id:
            return []
        dataset_id = apify_aguardar_run(run_id, timeout=180)
        if not dataset_id:
            return []
        return apify_buscar_resultados(dataset_id)
    except Exception as e:
        log(f"  Apify (perfis) falhou: {e}")
        return []


def gravar_metricas_perfis(permitir_apify=True):
    """Tira um retrato dos contadores publicos de cada perfil monitorado e
    grava um ponto novo na serie de `profile_metrics`.

    E o que alimenta o ranking de seguidores da tela "Analise por Perfil": o
    total atual sai do ponto mais recente; ganhos e perdas saem da diferenca
    entre pontos consecutivos. Por isso a tabela e uma SERIE (uma linha por
    coleta), nao um registro unico sobrescrito — sem historico nao existe
    delta para mostrar.

    Limite honesto do que da pra medir: o Instagram publica so o TOTAL de
    seguidores de uma conta, nunca quem entrou ou quem saiu. O que o painel
    mostra e o SALDO da janela (ganhou X, perdeu Y liquidos) — a UI diz isso
    com todas as letras em vez de sugerir uma lista de quem deixou de seguir.

    Fonte: Instagrapi primeiro (gratis); Apify so como fallback, e apenas
    quando `permitir_apify` — a flag `--seguidores` roda de graca por padrao.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return 0
    handles = list(PERFIS.keys())
    if not handles:
        log("  Sem perfis monitorados — nada a coletar")
        return 0

    log("=== MODULO 8b - Seguidores por perfil ===")
    brutos = _seguidores_via_instagrapi(handles)
    fonte  = "instagrapi"
    if not brutos and permitir_apify:
        log("  Instagrapi nao retornou — caindo para Apify")
        brutos = _seguidores_via_apify(handles)
        fonte  = "apify"
    if not brutos:
        log("  Nenhuma metrica de perfil coletada neste run")
        return 0

    agora_iso = datetime.now(TZ_BAHIA).isoformat()
    linhas = []
    for b in brutos:
        handle = str(extrair(b, "username", "ownerUsername", "handle", padrao="")).lstrip("@").lower()
        if handle not in PERFIS:
            continue
        seguidores = int(extrair(b, "followersCount", "followers_count", "follower_count", padrao=0) or 0)
        # Sem numero nao ha ponto: gravar 0 criaria uma queda falsa de milhares
        # de seguidores no grafico e dispararia a leitura de "perda".
        if seguidores <= 0:
            log(f"  @{handle}: sem contagem de seguidores na resposta — ponto ignorado")
            continue
        linhas.append({
            "tenant":      TENANT,
            "handle":      handle,
            "categoria":   PERFIS[handle].get("categoria", ""),
            "seguidores":  seguidores,
            "seguindo":    int(extrair(b, "followsCount", "following_count", "follows_count", padrao=0) or 0),
            "publicacoes": int(extrair(b, "postsCount", "media_count", "posts_count", padrao=0) or 0),
            "fonte":       fonte,
            "coletado_em": agora_iso,
        })

    n = _supabase_upsert("profile_metrics", linhas, "tenant,handle,coletado_em")
    log(f"  Seguidores gravados: {n} perfis (fonte: {fonte})")
    return n


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
    if not _auto_dispatch_ativo():
        log("  Disparo automatico desativado (reuniao 24/07) — alertas so manuais pelo dashboard")
        return 0
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
    if not _auto_dispatch_ativo():
        log(f"  Update detectado (@{post.get('autor','')}) mas disparo automatico desativado")
        return
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
    """Monta o boletim em 3 janelas (dia/semana/mes) e grava em boletins
    (tenant, dia, periodo). 100% determinístico (gerar_boletim), zero custo
    de IA — só médias sobre o historico que ja buscamos em daily_metrics."""
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
    # Semana/mes usam a media do risco da janela (o "dia" continua sendo o
    # risco pontual de hoje) -- serie_7d (contexto de tendencia) e as mesmas
    # nas 3 variantes, pois representam a trajetoria recente, nao o alvo.
    risco_semana = sum(serie_7d) / len(serie_7d)
    riscos_mes = [float(r.get("risco", 0) or 0) for r in hist_asc]
    risco_mes = sum(riscos_mes) / len(riscos_mes)

    # Termometro: pct_neg hoje vs ontem + media 30d (igual nas 3 variantes --
    # e o retrato de "agora" que contextualiza qualquer janela)
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

    # Frentes/alerta_ativo representam "o que esta acontecendo agora" -- nao
    # fazem sentido diluidos por janela, entao sao os mesmos nas 3 variantes.
    frentes = _frentes_por_tema(posts_analisados)
    dia = hist_asc[-1].get("dia") or datetime.now().strftime("%Y-%m-%d")
    gerado_em = datetime.now().isoformat()

    for periodo, risco in (("dia", risco_hoje), ("semana", risco_semana), ("mes", risco_mes)):
        boletim = gerar_boletim(
            risco=risco,
            serie_7d=serie_7d,
            termometro=termometro,
            rajadas=rajadas,
            frentes=frentes,
            alerta_post=alerta_post,
            override_resp_min=OVERRIDE_RESPONSABILIDADE_MIN,
            limiar_previsao=_LIMIAR_PREVISAO,
            limiar_tempestade_com_alerta=_LIMIAR_TEMPESTADE_COM_ALERTA,
            faixas=_ct.get("faixas"),
        )
        n = _supabase_upsert("boletins", [{
            "tenant": TENANT,
            "dia": dia,
            "periodo": periodo,
            "gerado_em": gerado_em,
            "boletim": boletim,
        }], "tenant,dia,periodo")
        log(f"  Boletim [{periodo}] gravado ({boletim['condicao']}, nivel={boletim['nivel_cor']}): {n} registro")



def main():
    inicio = datetime.now()
    # Contagem por run (no multi-tenant, por tenant): sem o reset, falha de
    # credito de um tenant contaminaria o veredito do seguinte.
    _zerar_saude_anthropic()
    log("+======================================================+")
    log(f"|  AGORA iniciando - {inicio.strftime('%d/%m/%Y %H:%M:%S')}              |")
    log("+======================================================+")

    # Sem Supabase nao ha destino nenhum (o Google Sheets saiu do fluxo em
    # 01/08/2026): rodar gastaria credito Apify/Anthropic para gravar em lugar
    # algum. Abortar aqui e mais barato que descobrir depois.
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("  " + "!" * 54)
        log("  ! SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.")
        log("  ! O Supabase e o UNICO destino dos dados — sem ele o run")
        log("  ! gastaria credito sem gravar nada. Pipeline encerrado.")
        log("  " + "!" * 54)
        return

    # Carrega estado anterior dos posts para detectar mudanças reais (dedup de alertas).
    # Sentinel None = carregamento falhou; bloqueia alertas para evitar spam
    # (se existentes_radar virasse {} por falha, todo post pareceria "novo" e todo alerta disparava).
    # Estrutura: {url: {"comentarios_total": int, "score_risco": int, "queixa_dominante": str}}
    def _snap(r):
        return {
            "comentarios_total": int(r.get("comentarios_total", 0) or 0),
            "score_risco":       int(r.get("score_risco", 0) or 0),
            "queixa_dominante":  (r.get("queixa_dominante", "") or "").strip(),
        }

    existentes_radar = None
    try:
        rows = _supabase_get(
            "posts",
            f"tenant=eq.{TENANT}&select=url,comentarios_total,score_risco,queixa_dominante"
        )
        existentes_radar = {r["url"]: _snap(r) for r in rows if r.get("url")}
        log(f"  {len(existentes_radar)} posts carregados do Supabase")
    except Exception as e:
        log(f"  Supabase existentes: falha ({e}) — alertas suspensos neste run para evitar spam")

    # Coleta YouTube (subsistema novo). Roda ANTES da coleta Instagram porque
    # esta pode encerrar o run cedo (coleta vazia). É inerte por si: sem fonte
    # YouTube ativa em `sources`, retorna sem tocar na Apify. _safe garante que
    # uma falha aqui nunca derruba o pipeline Instagram.
    if _YOUTUBE_OK:
        _safe("coletor_youtube", _yt.coletar_e_gravar)

    # Escuta do Radio: aqui roda SO A ANALISE, nunca a captura.
    #
    # A captura vive no workflow proprio (.github/workflows/radio.yml) porque o
    # ator grava EM TEMPO REAL: uma captura de 30 min e um run de 30 min. O step
    # deste pipeline tem timeout de 20 min e o job de 30 (ver agora.yml), entao
    # capturar aqui derrubaria o ÁGORA inteiro no dia em que o horario de um
    # programa coincidisse com uma das tres rodadas — levando embora Instagram,
    # clima, alertas e briefing junto.
    #
    # A analise nao tem esse problema: ela le do banco o que o radio.yml gravou,
    # gasta segundos e ainda recupera captura que ficou pendente (run que caiu
    # depois de gravar). Sem bloco pendente, retorna sem chamar o modelo.
    if _RADIO_OK:
        _safe("analise_radio", analisar_radio)

    posts = coletar_posts()
    if not posts:
        log("  Nenhum post coletado. Pipeline encerrado.")
        _safe("log_coleta_ig_vazia", _registrar_coleta, "instagram", "posts", 0, "vazio")
        # Registra status mesmo sem posts (ex: limite mensal atingido) e
        # devolve o consumo, para o alerta abaixo dizer a CAUSA.
        _apify = _safe("creditos_apify", verificar_creditos_apify) or {}
        # Sem isto, um run com coleta vazia (Instagram bloqueando, token
        # expirado etc.) saia sem tocar pipeline_health — o banner de "coleta
        # vazia" no dashboard nunca via essa linha (so enxergava a saude do
        # ULTIMO run com sucesso) e ninguem era avisado ate o painel ficar
        # >8h desatualizado, em silencio. Grava a falha explicitamente e avisa
        # na hora, com o mesmo canal usado para alerta de credito Apify.
        duracao_vazio = (datetime.now() - inicio).seconds
        _safe("pipeline_health_vazio", _supabase_upsert, "pipeline_health", [{
            "tenant":           TENANT,
            "executado_em":     datetime.now().isoformat(),
            "duracao_s":        duracao_vazio,
            "posts_coletados":  0,
            "posts_analisados": 0,
            "alertas_enviados": 0,
            "status":           "coleta_vazia",
        }], "tenant")
        _run_id = os.environ.get("GITHUB_RUN_ID", "")
        _msg_coleta_vazia = (
            "🔴 *RADAR — coleta vazia*\n"
            "O pipeline rodou e nao trouxe nenhum post do Instagram.\n"
            "Causas comuns: bloqueio/rate-limit do Instagram, sessao/token "
            "expirado, ou credito Apify esgotado.\n"
            "O dashboard NAO tera dados novos ate a proxima execucao normalizar."
        )
        if _run_id:
            _msg_coleta_vazia += (
                f"\nRun: {os.environ.get('GITHUB_SERVER_URL','')}/"
                f"{os.environ.get('GITHUB_REPOSITORY','')}/actions/runs/{_run_id}"
            )
        _safe("alerta_coleta_vazia", _enviar_whatsapp, _msg_coleta_vazia)
        # Aditivo ao alerta acima (que vai pro grupo fixo): manda tambem pro
        # numero que o admin cadastrou em Configuracoes > Alerta de Suporte,
        # se houver um. Coleta vazia e "parado" do ponto de vista do produto
        # mesmo sem excecao nenhuma ter subido (main() retorna normalmente).
        if _ALERTA_SUPORTE_OK:
            # Causa CONHECIDA (teto da Apify) vira um alerta próprio, com o
            # valor e a ação, e só 1x/dia: a condição dura dias e quem resolve
            # é o dono da conta. Com o texto genérico e a dedup de 60min, cada
            # execução mandava um alerta novo (o pipeline roda 3x/dia e os runs
            # ficam a 5-6h um do outro, então a janela nunca pegava) — medido
            # em 06/08, com a Apify travada em 101% desde 27/07.
            if float(_apify.get("pct") or 0) >= 100:
                _safe("alerta_suporte_apify", _alerta.disparar,
                      "apify_sem_credito",
                      f"Coleta parada: creditos da Apify esgotados "
                      f"(US$ {_apify['uso']:.2f} de US$ {_apify['teto']:.2f}). "
                      f"O ÁGORA continua rodando e volta com 0 posts ate a "
                      f"recarga em apify.com/billing.",
                      janela_dedup_min=1440)
            else:
                _safe("alerta_suporte_coleta_vazia", _alerta.disparar,
                      "coleta_vazia", "0 posts coletados do Instagram nesta execucao")
        return

    _safe("log_coleta_ig_posts", _registrar_coleta, "instagram", "posts", len(posts), "ok")

    comentarios_por_post = coletar_comentarios(posts)
    _total_coments_ig = sum(len(v) for v in comentarios_por_post.values())
    _safe("log_coleta_ig_coments", _registrar_coleta, "instagram", "comments",
          _total_coments_ig, "ok" if _total_coments_ig else "vazio")

    memoria = carregar_memoria()
    # Falha em carregar bairros aborta o run (RuntimeError) — nao gravamos
    # localidade='nao_identificado' em massa por indisponibilidade do Supabase.
    mapa_bairros = carregar_bairros(abortar_em_falha=True)
    posts_analisados = analisar_com_agora(posts, comentarios_por_post, memoria, mapa_bairros)
    # Cada etapa secundaria roda isolada (_safe): se uma falhar, as demais e os
    # ALERTAS (saida mais critica, por ultimo) continuam.
    _safe("creditos_apify", verificar_creditos_apify)                               # alerta quando creditos > 80%
    _safe("supabase", gravar_no_supabase, posts_analisados, comentarios_por_post)  # dual-write -> dashboard
    _safe("recalc_sentimento", recalcular_sentimento_posts)                        # reprojeta comments->posts p/ evitar o dessync do "0% criticas"
    _safe("expurgo_pii", expurgar_pii)                                             # LGPD: apaga texto/@ do autor fora da janela de retencao
    _safe("expurgo_pii_radio", expurgar_pii_radio)                                 # LGPD: apaga transcricao bruta de radio fora da retencao
    _safe("daily_metrics", gravar_daily_metrics, posts_analisados)                 # historico de indices (Fase 3)
    _safe("boletim_climatico", gravar_boletim_climatico, posts_analisados)         # boletim climatico (Radar Comando)
    briefing_ia = _safe("briefing_estrategico", gerar_briefing_estrategico, posts_analisados)  # assistente IA (Fase 3d)
    # Briefing matinal: run das 08h BRT (11h UTC) — aceita 11 ou 12 UTC p/ tolerar
    # atraso do cron do GitHub Actions. Forcar com BRIEFING_MATINAL=true.
    hora_utc = datetime.utcnow().hour
    if briefing_ia and (hora_utc in (11, 12) or os.environ.get("BRIEFING_MATINAL", "").lower() == "true"):
        _safe("briefing_matinal", enviar_briefing_matinal, posts_analisados, briefing_ia)
    # Briefings de semana/mes: so 1x/dia (mesmo guard do briefing matinal) —
    # a janela muda pouco de manha pra tarde, gerar nos 2 runs so duplicaria
    # custo de IA a toa.
    if hora_utc in (11, 12) or os.environ.get("BRIEFING_MATINAL", "").lower() == "true":
        _safe("briefings_periodo", gerar_briefings_periodo)
    _safe("cacador_crises", rodar_cacador_crises, posts_analisados, comentarios_por_post)  # agente caçador de crises (Fase B)
    _safe("influencers", gravar_influencers, posts_analisados, comentarios_por_post)       # ranking de influenciadores
    _safe("seguidores", gravar_metricas_perfis)                                            # serie de seguidores por perfil (ranking + saldo)
    _safe("narratives", gravar_narratives, posts_analisados, comentarios_por_post)         # narrativas (tema + sentimento)
    _safe("daily_themes", gravar_daily_themes, posts_analisados)                           # tendencias por tema (Fase 3e)
    temas_alertados = _safe("alertas_limiar", verificar_alertas, posts_analisados) or []   # alertas por limiar (Sprint 2)
    _safe("alerta_subtema", verificar_alerta_subtema)                                      # sensacao popular por subtema (24h)
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

    # Ultima etapa que olha o modelo: se o run inteiro rodou com a Anthropic
    # fora do ar (credito esgotado/chave invalida), tudo acima gravou defaults
    # sem nenhuma excecao subir — este e o unico ponto que enxerga o conjunto.
    _safe("saude_anthropic", _verificar_saude_anthropic)

    fim = datetime.now()
    duracao = (fim - inicio).seconds
    log("")
    log("+======================================================+")
    log(f"|  AGORA concluido                                      |")
    log(f"|  Posts coletados:    {len(posts):<4}                          |")
    log(f"|  Posts analisados:   {len(posts_analisados):<4}                          |")
    log(f"|  Comentarios coletados: {_total_coments_ig:<4}                       |")
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
        "tenants",
        "ativo=eq.true&select=tenant_id,municipio,estado,apify_token,whatsapp_destinatarios"
    )

    if not tenants_ativos:
        log("  Tabela 'tenants' vazia ou ausente — modo single-tenant.")
        main()
        return

    log("+======================================================+")
    log(f"|  AGORA Multi-Tenant: {len(tenants_ativos)} tenant(s) ativo(s)       |")
    log("+======================================================+")

    global TENANT, APIFY_TOKEN, WHATSAPP_NUMBER
    # Guarda os valores das secrets do ambiente (conta/numero "padrao") para
    # usar como fallback nos tenants que ainda nao tem os proprios cadastrados
    # em tenants.apify_token / tenants.whatsapp_destinatarios.
    apify_token_padrao = APIFY_TOKEN
    whatsapp_numero_padrao = WHATSAPP_NUMBER
    for t in tenants_ativos:
        tid = t.get("tenant_id", TENANT)
        municipio = t.get("municipio", tid)

        TENANT = tid
        log(f"\n=== TENANT: {tid} ({municipio} / {t.get('estado', '')}) ===")
        try:
            # Antes: perfis_json (coluna legada de tenants, nunca escrita
            # pelo Admin) era a unica fonte de perfis no loop multi-tenant,
            # e nenhuma outra config (keywords, limiares de clima/notificacao)
            # era recarregada por tenant — o 2o+ tenant herdava silenciosamente
            # a config carregada para o 1o na inicializacao do modulo.
            # Agora: mesmo carregador usado no boot single-tenant, parametrizado.
            # Dentro do try: um tenant com tenant_settings malformado (ex.:
            # override_resp_min nao-numerico) nao pode derrubar o loop inteiro
            # e impedir os demais tenants de rodar.
            _carregar_config_tenant(tid)
            APIFY_TOKEN = t.get("apify_token") or apify_token_padrao
            destinatarios = t.get("whatsapp_destinatarios") or []
            # So o primeiro destinatario e usado (Evolution API manda pra 1
            # numero por chamada); a coluna e um array pensando em fan-out
            # futuro, ainda nao implementado.
            WHATSAPP_NUMBER = destinatarios[0] if destinatarios else whatsapp_numero_padrao
            main()
        except Exception as e:
            log(f"  ERRO no tenant {tid}: {e}")


def teste_sentimento(max_posts=8, so_divergencias=True):
    """Reclassifica uma amostra REAL de comentarios com os criterios atuais e
    compara com o que esta gravado no Supabase. NAO grava nada.

    Existe para medir o efeito de qualquer mexida nos criterios de sentimento
    antes de mandar pra producao — o equivalente do --teste-filtro para o lado
    da classificacao. Custo: so Anthropic (Haiku), nenhum credito Apify.

    `--teste-sentimento [N]`      → amostra dos N posts com mais comentarios
    `--teste-sentimento N --tudo` → lista tambem os que nao mudaram
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[teste-sentimento] SUPABASE ausente.")
        return
    if not ANTHROPIC_KEY:
        print("[teste-sentimento] ANTHROPIC_API_KEY ausente.")
        return

    posts = _supabase_get(
        "posts",
        f"tenant=eq.{TENANT}&select=url,autor,categoria,caption"
        f"&order=comentarios_total.desc&limit={max_posts}",
    )
    if not posts:
        print("[teste-sentimento] Nenhum post encontrado.")
        return

    cliente = _cliente_anthropic()
    from urllib.parse import quote

    mudou, igual = [], 0
    placar_antes, placar_depois = {}, {}
    for p in posts:
        coments = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&tipo=eq.cidadao"
            f"&url_post=eq.{quote(p['url'], safe='')}"
            f"&select=id,username,texto,curtidas,sentimento,confianca_tema"
            f"&order=curtidas.desc&limit=100",
        )
        coments = [c for c in coments if (c.get("texto") or "").strip()]
        if not coments:
            continue

        print(f"  @{p['autor']} ({p.get('categoria','')}) — {len(coments)} comentarios…")
        novo = analisar_comentarios_haiku(p, coments, cliente)
        for idx, c in enumerate(coments):
            item = novo.get(idx)
            if not item:
                continue
            antes = (c.get("sentimento") or "neutro").lower()
            depois = (item.get("sentimento") or "neutro").lower()
            if depois not in ("positivo", "negativo", "neutro"):
                depois = "neutro"
            try:
                conf = int(item.get("confianca_tema") or 0)
            except (TypeError, ValueError):
                conf = 0
            # Aplica a mesma politica do painel: confianca baixa nao vira lado.
            if not _sentimento_confiavel({"confianca_tema": conf}):
                depois = "neutro"
            placar_antes[antes] = placar_antes.get(antes, 0) + 1
            placar_depois[depois] = placar_depois.get(depois, 0) + 1
            if antes != depois:
                mudou.append((p.get("categoria", ""), antes, depois, conf, c.get("texto", "")))
            else:
                igual += 1

    total = igual + len(mudou)
    if not total:
        print("[teste-sentimento] Nenhum comentario reclassificado.")
        return

    print(f"\n[teste-sentimento] {total} comentarios reclassificados · "
          f"{len(mudou)} mudaram ({round(len(mudou) / total * 100)}%)\n")
    print("  ANTES  :", " ".join(f"{k}={v}" for k, v in sorted(placar_antes.items())))
    print("  DEPOIS :", " ".join(f"{k}={v}" for k, v in sorted(placar_depois.items())))

    if so_divergencias and mudou:
        print("\n[mudancas]")
        for cat, antes, depois, conf, texto in mudou:
            t = " ".join((texto or "").split())[:110]
            print(f"  {antes:>8} -> {depois:<8} [conf {conf:>3}] ({cat}) {t!r}")


def amostra_rotulagem(por_estrato=100, semente=42):
    """Sorteia a amostra e gera a planilha de rotulagem humana (item 2.10 da
    auditoria: a acuracia nunca foi medida contra rotulo humano).

    Escreve DOIS arquivos:
      rotulagem_<data>.html  -> planilha CEGA, para uma pessoa rotular
      gabarito_<data>.json   -> o que o modelo respondeu + tamanho dos estratos

    O gabarito fica separado de proposito: rotulador que ve o palpite da maquina
    concorda com ela por ancoragem, e a medicao perde o sentido.

    O HTML e um arquivo LOCAL e NAO deve ser publicado: ele contem texto e @ de
    cidadaos reais, que e o dado que a politica de retencao (migration 009)
    existe para proteger.

    Custo ZERO: nao chama Apify nem Anthropic.
    """
    import acuracia

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[rotulagem] SUPABASE ausente.")
        return

    comentarios, page = [], 0
    while True:
        chunk = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&tipo=eq.cidadao"
            f"&select=id,texto,sentimento,confianca_tema,url_post,autor_post,categoria_post"
            f"&limit=1000&offset={page * 1000}",
        )
        if not chunk:
            break
        comentarios.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
    if not comentarios:
        print("[rotulagem] Nenhum comentario de cidadao encontrado.")
        return

    # Legenda do post como contexto: o rotulador precisa da mesma informacao
    # que o modelo teve, senao a comparacao e injusta (ex.: materia sobre outra
    # cidade muda a resposta certa).
    captions = {p["url"]: (p.get("caption") or "")
                for p in (_supabase_get("posts", f"tenant=eq.{TENANT}&select=url,caption") or [])
                if p.get("url")}
    for c in comentarios:
        c["caption_post"] = captions.get(c.get("url_post", ""), "")

    amostra, estratos = acuracia.montar_amostra(comentarios, por_estrato, semente)
    if not amostra:
        print("[rotulagem] Amostra vazia (todos os comentarios sem texto?).")
        return

    data = datetime.now().strftime("%Y%m%d")
    f_html, f_gab = f"rotulagem_{data}.html", f"gabarito_{data}.json"

    with open(f_html, "w", encoding="utf-8") as f:
        f.write(acuracia.gerar_html_rotulagem(
            amostra, titulo=f"Rotulagem de sentimento — {TENANT}"))
    with open(f_gab, "w", encoding="utf-8") as f:
        json.dump({
            "tenant": TENANT, "gerado_em": datetime.now().isoformat(),
            "semente": semente, "estratos": estratos,
            "gabarito": {str(c["id"]): {
                "previsto": (c.get("sentimento") or "neutro").lower(),
                "confianca": int(c.get("confianca_tema") or 0),
            } for c in amostra},
        }, f, ensure_ascii=False, indent=2)

    print(f"[rotulagem] {len(amostra)} comentarios sorteados de {len(comentarios)}")
    for classe, e in estratos.items():
        print(f"    {classe:<10} {e['n']:>4} da amostra  (universo: {e['N']})")
    print(f"\n  Planilha : {f_html}")
    print(f"  Gabarito : {f_gab}  (NAO abra antes de rotular)")
    print("\n  1. Abra a planilha no navegador e rotule (atalhos 1/2/3/0).")
    print("     O progresso fica salvo no navegador, da pra parar e voltar.")
    print("  2. Clique em 'Exportar CSV' ao terminar.")
    print(f"  3. python agora.py --medir-acuracia rotulos.csv {f_gab}")


def medir_acuracia(caminho_rotulos, caminho_gabarito=None):
    """Cruza os rotulos humanos com o gabarito do modelo e reporta as metricas.

    Custo ZERO: so aritmetica sobre dois arquivos locais.
    """
    import acuracia
    import glob as _glob

    if not caminho_gabarito:
        candidatos = sorted(_glob.glob("gabarito_*.json"))
        if not candidatos:
            print("[acuracia] Nenhum gabarito_*.json encontrado. Rode --amostra-rotulagem antes.")
            return
        caminho_gabarito = candidatos[-1]

    try:
        with open(caminho_gabarito, encoding="utf-8") as f:
            gab = json.load(f)
        rotulos = acuracia.ler_rotulos_csv(caminho_rotulos)
    except (OSError, ValueError) as e:
        print(f"[acuracia] Falha ao ler os arquivos: {e}")
        return

    if not rotulos:
        print("[acuracia] Nenhum rotulo valido no CSV.")
        return

    pares, orfaos = [], 0
    for rid, verdadeiro in rotulos.items():
        item = gab.get("gabarito", {}).get(rid)
        if not item:
            orfaos += 1
            continue
        pares.append({"previsto": item["previsto"], "verdadeiro": verdadeiro,
                      "confianca": item.get("confianca", 0)})

    if not pares:
        print("[acuracia] Nenhum id do CSV bate com o gabarito. Arquivos de rodadas diferentes?")
        return

    n_amostra = sum(e["n"] for e in gab["estratos"].values())
    print(f"[acuracia] gabarito: {caminho_gabarito} | rotulos: {caminho_rotulos}")
    print(f"  {len(pares)} de {n_amostra} rotulados"
          f"{f' ({orfaos} ids sem correspondencia)' if orfaos else ''}")
    nao_sei = n_amostra - len(rotulos)
    if nao_sei > 0:
        print(f"  {nao_sei} ficaram sem rotulo ou marcados 'nao sei' (fora da conta)")
    if len(pares) < n_amostra * 0.5:
        print("  ATENCAO: menos da metade da amostra foi rotulada; os intervalos "
              "de confianca vao ficar largos e as conclusoes fracas.")

    print(acuracia.formatar_relatorio(acuracia.calcular_metricas(pares, gab["estratos"])))
    print(acuracia.formatar_relatorio(
        acuracia.calcular_metricas(pares, gab["estratos"], so_confiantes=True)))
    print("\n  O segundo bloco e o numero que importa para o clima: o painel so "
          "conta comentario com confianca >= 50.")


def teste_tom(max_posts=20, categoria=None):
    """Classifica o TOM de uma amostra real de publicacoes SEM escrever nada.

    `--teste-tom [N] [--oposicao|--imprensa|--governo]`

    Serve para conferir o criterio antes de reclassificar a base (regra do
    CLAUDE.md: medir contra a base real antes de mexer em criterio). Custo: so
    Anthropic, uma chamada Haiku curta por post. Zero credito Apify.

    O que olhar no resultado: se todo post de oposicao sair 'critico' e todo
    post de governo sair 'favoravel', o modelo esta deduzindo pelo perfil em
    vez de ler o texto, que e exatamente o atalho que este campo existe para
    nao repetir. Agenda, aniversario e utilidade publica tem que sair 'neutro'
    dos dois lados.
    """
    if not SUPABASE_URL or not SUPABASE_KEY or not ANTHROPIC_KEY:
        print("[teste-tom] SUPABASE_URL / SUPABASE_SERVICE_KEY / ANTHROPIC_API_KEY ausentes.")
        return

    filtro = f"tenant=eq.{TENANT}"
    if categoria:
        filtro += f"&categoria=ilike.{categoria}"
    posts = _supabase_get(
        "posts",
        f"{filtro}&caption=neq.&select=url,autor,categoria,caption,tom_publicacao,"
        f"confianca_tom,sentimento_post&order=data_post.desc&limit={max_posts}",
    )
    if not posts:
        print(f"[teste-tom] Nenhum post{' de ' + categoria if categoria else ''} com legenda.")
        return

    cliente = _cliente_anthropic()
    print(f"[teste-tom] {len(posts)} publicacoes — tom classificado agora x gravado\n")

    placar = {}
    mudou = 0
    for p in posts:
        tom, conf = classificar_tom_publicacao(p.get("caption") or "", cliente)
        antes = p.get("tom_publicacao") or "nao_classificado"
        cat = (p.get("categoria") or "?").lower()
        placar.setdefault(cat, {}).setdefault(tom, 0)
        placar[cat][tom] += 1
        if antes != tom:
            mudou += 1
        baixa = " (confianca baixa, nao conta)" if conf < CONFIANCA_MIN_TOM else ""
        seta = "=" if antes == tom else "->"
        print(f"  @{(p.get('autor') or '')[:20]:<20} [{cat[:10]:<10}] "
              f"{antes:<16} {seta} {tom:<10} conf={conf:>3}{baixa}")
        # 220 caracteres, e nao 96: o juizo costuma estar no meio da legenda,
        # nao na abertura. Com o preview curto, um post que cobrava a
        # Prefeitura na Justica aparecia aqui como "de volta as ruas" e passava
        # por erro do classificador quando o classificador estava certo.
        _leg = " ".join((p.get("caption") or "").split())[:220]
        print(f"      reacao gravada: {p.get('sentimento_post') or '?'} | legenda: {_leg}")
        time.sleep(0.6)

    print("\n  Placar por categoria (tom classificado agora):")
    for cat in sorted(placar):
        linha = " ".join(f"{t}={n}" for t, n in sorted(placar[cat].items()))
        print(f"    {cat:<14} {linha}")
    print(f"\n  {mudou}/{len(posts)} mudariam se a reclassificacao rodasse agora.")
    print("  'reacao gravada' e o sentimento_post (o que o povo respondeu). "
          "Discordar do tom e o esperado, nao um erro.")


def reclassificar_tom(limite=500, dry_run=False, refazer=False):
    """Preenche `posts.tom_publicacao` na base ja existente.

    `--reclassificar-tom --dry-run`  → so conta o que falta, nao chama a API
    `--reclassificar-tom [N]`        → classifica ate N publicacoes pendentes
    `--reclassificar-tom N --refazer`→ inclui as ja classificadas (mudanca de criterio)

    Idempotente: por padrao so toca em quem esta 'nao_classificado', entao
    rodar duas vezes nao gasta token a toa nem reescreve o que ja foi medido.
    Custo: so Anthropic. Nenhum credito Apify e nenhuma coleta.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[tom] SUPABASE_URL / SUPABASE_SERVICE_KEY ausentes.")
        return
    from urllib.parse import quote

    filtro = f"tenant=eq.{TENANT}&caption=neq."
    if not refazer:
        filtro += "&tom_publicacao=eq.nao_classificado"
    pendentes = _supabase_get(
        "posts",
        f"{filtro}&select=url,autor,caption&order=data_post.desc&limit={limite}",
    )
    if not pendentes:
        print("[tom] Nada a classificar: todas as publicacoes com legenda ja tem tom.")
        return

    if dry_run:
        print(f"[tom] {len(pendentes)} publicacoes seriam classificadas "
              f"(limite {limite}, refazer={refazer}). Nenhuma chamada feita.")
        for p in pendentes[:10]:
            print(f"    @{p.get('autor','')}: {(p.get('caption') or '')[:80].strip()}")
        if len(pendentes) > 10:
            print(f"    ... e mais {len(pendentes) - 10}")
        return

    if not ANTHROPIC_KEY:
        print("[tom] ANTHROPIC_API_KEY ausente.")
        return

    cliente = _cliente_anthropic()
    print(f"[tom] Classificando {len(pendentes)} publicacoes…")
    placar, gravados = {}, 0
    for i, p in enumerate(pendentes, 1):
        tom, conf = classificar_tom_publicacao(p.get("caption") or "", cliente)
        placar[tom] = placar.get(tom, 0) + 1
        ok = _supabase_patch(
            "posts",
            f"url=eq.{quote(p['url'], safe='')}&tenant=eq.{TENANT}",
            {"tom_publicacao": tom, "confianca_tom": conf},
        )
        gravados += 1 if ok else 0
        if i % 25 == 0 or i == len(pendentes):
            print(f"    {i}/{len(pendentes)} · {gravados} gravados")
        time.sleep(0.6)

    print(f"\n[tom] {gravados}/{len(pendentes)} gravados.")
    for t, n in sorted(placar.items()):
        print(f"    {t:<18} {n}")


def teste_triagem(max_posts=6, categoria="oposicao"):
    """Roda SO a triagem (PROMPT_TRIAGEM) numa amostra real e compara com o que
    esta gravado. NAO grava nada. Custo: so Anthropic (Haiku), zero Apify.

    POR QUE EXISTE (auditoria de 26/07): a triagem nao tinha harness de teste.
    Foi por isso que ela ficou de fora da revisao de 25/07 e seguiu mandando
    classificar "apoio a opositor" como critica a gestao. Isso importa porque a
    triagem produz score_risco, urgencia e risco_crise e decide se o post sobe
    para o Sonnet, e o recalcular_sentimento_posts (que conserta os percentuais
    a partir dos comentarios) nao toca em nenhum desses campos.

    Prioriza posts de OPOSICAO, que e onde o atalho distorcia mais: e la que
    "parabens vereador" era contado como reprovacao da gestao.

    `--teste-triagem [N] [--imprensa|--governo]`
    """
    if not SUPABASE_URL or not SUPABASE_KEY or not ANTHROPIC_KEY:
        print("[teste-triagem] SUPABASE_URL / SUPABASE_SERVICE_KEY / ANTHROPIC_API_KEY ausentes.")
        return

    from urllib.parse import quote
    posts = _supabase_get(
        "posts",
        f"tenant=eq.{TENANT}&categoria=ilike.{categoria}"
        f"&select=url,autor,categoria,caption,score_risco,comentarios_pct_pos,"
        f"comentarios_pct_neg,sentimento_comentarios"
        f"&order=comentarios_total.desc&limit={max_posts}",
    )
    if not posts:
        print(f"[teste-triagem] Nenhum post da categoria '{categoria}'.")
        return

    cliente = _cliente_anthropic()
    print(f"[teste-triagem] {len(posts)} posts de '{categoria}' — comparando triagem atual x gravado\n")
    print(f"  {'perfil':<24} {'score':>12} {'%favoravel':>22} {'%critico':>20}")

    for p in posts:
        coments = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&url_post=eq.{quote(p['url'], safe='')}"
            f"&select=texto,username,curtidas,tipo&order=curtidas.desc&limit=60",
        )
        coments = [
            {"tipo": c.get("tipo", "cidadao"), "curtidas": int(c.get("curtidas") or 0),
             "username": c.get("username") or "", "texto": c.get("texto") or ""}
            for c in coments if (c.get("texto") or "").strip()
        ]
        if not coments:
            continue

        post = {"autor": p.get("autor", ""), "categoria": p.get("categoria", ""),
                "caption": p.get("caption") or ""}
        try:
            rt = cliente.messages.create(
                model=MODELO_ANALISTA, max_tokens=180, system=PROMPT_TRIAGEM,
                messages=[{"role": "user", "content": triar_post_rapido(post, coments)}],
            )
            novo = _parse_json_resposta(rt.content[0].text)
        except Exception as e:
            print(f"  @{p.get('autor','')}: falhou ({e})")
            continue

        def _cmp(antes, depois):
            a, d = int(antes or 0), int(depois or 0)
            seta = "=" if a == d else ("v" if d < a else "^")
            return f"{a:>3} {seta} {d:<3}"

        print(f"  @{p.get('autor',''):<23} "
              f"{_cmp(p.get('score_risco'), novo.get('score_risco')):>12} "
              f"{_cmp(p.get('comentarios_pct_pos'), novo.get('comentarios_pct_pos')):>22} "
              f"{_cmp(p.get('comentarios_pct_neg'), novo.get('comentarios_pct_neg')):>20}")
        time.sleep(1)

    print("\n  Legenda: gravado -> triagem atual. 'v' caiu, '^' subiu, '=' igual.")
    print("  Em posts de oposicao, o efeito esperado da correcao e %critico CAIR:")
    print("  elogio a opositor deixa de ser contado como reprovacao da gestao.")


def teste_filtro(limite=5, detalhar=True):
    """Roda o filtro de relevância contra a base real do Supabase.

    `--teste-filtro`         → últimos 5 posts, com caption e motivo de cada um.
    `--teste-filtro N`       → últimos N posts (N=0 → base inteira, até 5000).
    `--teste-filtro N --resumo` → só o placar por categoria/perfil, sem captions.

    Serve para MEDIR o impacto de qualquer mexida no critério antes de mandar
    pra produção (regra do CLAUDE.md). Custo zero de créditos: só lê Postgres.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[teste-filtro] SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.")
        return

    # Keywords em uso, ja classificadas em especificas x genericas.
    # (Antes esta funcao lia `_keywords_banco`, que e local de
    # _carregar_config_tenant — a flag quebrava com NameError.)
    esp, gen, ancoras = _classificar_keywords(tuple(KEYWORDS_IMPRENSA))
    todas = _ancoras_ativas(ancoras)
    print(f"[keywords] {len(KEYWORDS_IMPRENSA)} cadastradas na tela Relevância")
    print(f"  especificas (valem sozinhas) : {list(esp)}")
    print(f"  genericas (exigem ancora)    : {list(gen)}")
    print(f"  ancoras das keywords         : {sorted(ancoras)}")
    print(f"  ancoras dos perfis (Fontes)  : {sorted(todas - ancoras)}")

    n = 5000 if not limite else limite
    print(f"\n[teste-filtro] Buscando até {n} posts do Supabase…")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/posts",
        params={"tenant": f"eq.{TENANT}", "select": "autor,caption,categoria",
                "order": "data_post.desc", "limit": n},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=30,
    )
    if r.status_code != 200:
        print(f"[teste-filtro] Erro ao buscar posts: {r.status_code} {r.text[:200]}")
        return

    posts = r.json()
    if not posts:
        print("[teste-filtro] Nenhum post encontrado no Supabase.")
        return

    print(f"\n[teste-filtro] {len(posts)} posts — testando filtro de relevância:\n")
    # placar[filtro] = [passaram, descartados]; por_perfil[handle] = idem
    placar, por_perfil, motivos_descarte = {}, {}, {}
    for i, p in enumerate(posts, 1):
        handle  = (p.get("autor") or "(desconhecido)").lower()
        caption = p.get("caption") or ""
        info    = PERFIS.get(handle, {"categoria": "Desconhecido", "filtro": "governo"})
        filtro  = info["filtro"]

        passou, motivo = _motivo_relevancia(caption, filtro)

        placar.setdefault(filtro, [0, 0])[0 if passou else 1] += 1
        por_perfil.setdefault(handle, [0, 0, filtro])[0 if passou else 1] += 1
        if not passou:
            motivos_descarte[motivo] = motivos_descarte.get(motivo, 0) + 1

        if detalhar:
            status = "✔ PASSOU" if passou else "✘ DESCARTADO"
            print(f"  [{i}] @{handle} ({filtro}) → {status}")
            print(f"       motivo : {motivo}")
            print(f"       caption: {caption[:300]!r}")
            print()

    tot_ok  = sum(v[0] for v in placar.values())
    tot_out = sum(v[1] for v in placar.values())
    print(f"\n[placar] {tot_ok} passam · {tot_out} descartados "
          f"({round(tot_out / max(1, tot_ok + tot_out) * 100)}% da base)")
    for filtro, (ok, out) in sorted(placar.items()):
        print(f"  {filtro:<9} passam={ok:<5} descartados={out}")
    print("\n[por perfil]")
    for handle, (ok, out, filtro) in sorted(por_perfil.items(), key=lambda x: -x[1][1]):
        marca = "  <<<" if out else ""
        print(f"  @{handle:<24} ({filtro:<8}) passam={ok:<4} descartados={out}{marca}")
    if motivos_descarte:
        print("\n[motivos de descarte]")
        for motivo, qtd in sorted(motivos_descarte.items(), key=lambda x: -x[1]):
            print(f"  {qtd:<5} {motivo}")


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

    # Memoria contextual (Supabase; tolerado falhar)
    memoria = ""
    try:
        memoria = carregar_memoria()
    except Exception as e:
        log(f"  Memoria indisponivel ({e}) — memoria vazia")

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


# Casos com resposta conhecida. O primeiro bloco e a contaminacao real achada
# em 27/07 no Mapa da Cidade; os demais protegem o que precisa continuar
# funcionando, para a correcao nao virar excesso de zelo que descarta bairro
# legitimo. Cada linha e (valor_que_o_modelo_devolveria, slug_esperado).
_CASOS_LOCALIDADE = [
    # O caso que quebrou: nome de equipamento nao e bairro.
    ("Centro de Testagem e Aconselhamento - CTA Alagoinhas-Ba", "nao_identificado"),
    ("Centro de Testagem e Aconselhamento", "nao_identificado"),
    ("centro de saude", "nao_identificado"),
    ("centro cirurgico", "nao_identificado"),
    ("Cruzeiro do Sul", "nao_identificado"),
    # Achados na varredura da base inteira: o apelido "no centro" tem duas
    # palavras e escapava da checagem quando ela olhava o alias todo em vez da
    # ultima palavra dele.
    ("no centro de cirurgias Eletivas", "nao_identificado"),
    ("no Centro Administrativo", "nao_identificado"),
    ("Centro de Convivencia", "nao_identificado"),
    # O bairro Centro de verdade precisa continuar resolvendo.
    ("Centro", "centro"),
    ("no centro", "centro"),
    ("centro da cidade", "centro"),
    ("centro de Alagoinhas", "centro"),
    ("Centro.", "centro"),
    ("(CENTRO)", "centro"),
    # Apelido generico precedido de preposicao de lugar continua valendo. Os
    # tres primeiros sao falsos positivos que a primeira versao da correcao
    # produziu ao rodar contra a base real: eram bairro de verdade.
    ("no Riacho", "riacho_da_guia"),
    ("no barreiro", "barreiro"),
    ("bairro Centro", "centro"),
    ("rua do Catu", "catu"),
    # Alias mais longo tem de vencer o mais curto.
    ("Riacho da Guia", "riacho_da_guia"),
    ("Alto do Cruzeiro", "alto_do_cruzeiro"),
    # Bairros de nome distintivo seguem resolvendo dentro de frase.
    ("bairro Santa Terezinha", "santa_terezinha"),
    ("praca Kennedy", "kennedy"),
    ("Jardim Petrolar", "jardim_petrolar"),
    ("zona rural", "area_rural"),
    # Sem lugar citado.
    ("", "nao_identificado"),
    ("a prefeitura toda", "nao_identificado"),
]


def reparar_localidade(dry_run=False):
    """Desfaz atribuicoes de bairro que vieram do bug de alias generico.

    `--reparar-localidade --dry-run`  → so lista o que mudaria
    `--reparar-localidade`            → grava

    Como decide: para cada comentario ja atribuido a um bairro cujo apelido e
    substantivo comum (Centro, Alto do Cruzeiro, Riacho da Guia...), verifica
    se o TEXTO do comentario menciona aquele bairro como LUGAR, pela mesma
    regra nova de normalizar_localidade. Se em nenhum ponto do texto a palavra
    aparece como lugar, a atribuicao so pode ter vindo de um nome composto
    ("Centro de Testagem e Aconselhamento") e a linha volta para
    'nao_identificado'.

    Nao chama o modelo: e leitura de texto ja gravado mais a regra corrigida.
    Custo zero de token e de credito Apify.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[reparar-localidade] SUPABASE_URL / SUPABASE_SERVICE_KEY ausentes.")
        return
    mapa = carregar_bairros(abortar_em_falha=False)
    if mapa == _BAIRRO_FALLBACK_MINIMO:
        print("[reparar-localidade] ABORTANDO: mapa de bairros indisponivel.")
        return

    # Slugs em risco: os que tem ao menos um apelido que e substantivo comum.
    aliases_por_slug = {}
    for alias_norm, slug in mapa.items():
        aliases_por_slug.setdefault(slug, []).append(alias_norm)
    em_risco = {
        slug: al for slug, al in aliases_por_slug.items()
        if any(_alias_extensivel(a) for a in al)
    }
    if not em_risco:
        print("[reparar-localidade] Nenhum bairro deste tenant tem apelido generico.")
        return
    print(f"[reparar-localidade] Bairros em risco: {sorted(em_risco)}")

    linhas = _supabase_get(
        "comments",
        f"tenant=eq.{TENANT}&localidade=in.({','.join(em_risco)})"
        f"&texto=not.is.null&select=id,localidade,texto&limit=5000",
    ) or []
    print(f"[reparar-localidade] {len(linhas)} comentarios a conferir.\n")

    suspeitos = []
    for c in linhas:
        slug = c.get("localidade")
        texto = _norm(c.get("texto") or "")
        aliases = aliases_por_slug.get(slug, [])
        # Algum apelido NAO generico aparece? Entao o bairro tem apoio direto
        # no texto ("riacho da guia", "santa terezinha") e nada a fazer.
        if any(not _alias_extensivel(a) and _tem_termo(texto, a) for a in aliases):
            continue
        # Sobra o caso do apelido generico: so e contaminacao quando TODA
        # ocorrencia dele e cabeca de nome composto.
        genericos = [a for a in aliases if _alias_extensivel(a)]
        if genericos and all(_so_em_composto(texto, a, TENANT) for a in genericos):
            suspeitos.append(c)

    if not suspeitos:
        print("[reparar-localidade] Nada a corrigir: todo bairro atribuido tem apoio no texto.")
        return

    print(f"[reparar-localidade] {len(suspeitos)} linhas sem apoio no texto:\n")
    for c in suspeitos:
        print(f"  {c['localidade']:<18} -> nao_identificado")
        print(f"      {' '.join((c.get('texto') or '').split())[:150]}")
    if dry_run:
        print("\n[reparar-localidade] --dry-run: nada gravado.")
        return

    ok = 0
    for c in suspeitos:
        if _supabase_patch("comments", f"id=eq.{c['id']}&tenant=eq.{TENANT}",
                           {"localidade": "nao_identificado"}):
            ok += 1
    print(f"\n[reparar-localidade] {ok}/{len(suspeitos)} corrigidos.")


def _bairro_no_texto(texto_norm: str, mapa_bairros: dict, tenant: str):
    """Bairro nomeado de forma INEQUIVOCA no texto, ou None.

    Usada so pela recuperacao, e por isso mais exigente que o normalizador: em
    vez de resolver o que o modelo extraiu, ela decide sozinha o que o modelo
    deixou passar. Inventar bairro errado e pior que deixar em branco, entao a
    duvida sempre resolve para None.

    Recusa apelido extensivel sem prova de lugar (o mesmo criterio do CTA) e
    recusa nome de santo em contexto de festa.
    """
    for alias_norm, slug in sorted(mapa_bairros.items(), key=lambda kv: -len(kv[0] or "")):
        if slug == "nao_identificado" or not alias_norm:
            continue
        m = _padrao(alias_norm).search(texto_norm)
        if not m:
            continue
        if _alias_extensivel(alias_norm) and not _generico_e_lugar(texto_norm, alias_norm, tenant):
            continue
        if _contexto_de_festa(texto_norm, m.start()):
            continue
        return slug, alias_norm
    return None


def recuperar_localidade(dry_run=False):
    """Preenche localidade onde o TEXTO nomeia um bairro e a linha ficou vazia.

    `--recuperar-localidade --dry-run`  → so lista o que mudaria
    `--recuperar-localidade`            → grava

    E o outro lado do --reparar-localidade: aquele desfaz atribuicao errada,
    este recupera captura perdida. Nao chama o modelo — le o texto ja gravado e
    aplica a regra corrigida, entao custa zero token e zero credito Apify.

    So mexe em linha que esta como 'nao_identificado'. Nunca sobrescreve bairro
    ja atribuido: se o modelo decidiu algo, a decisao dele fica.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[recuperar-localidade] SUPABASE_URL / SUPABASE_SERVICE_KEY ausentes.")
        return
    mapa = carregar_bairros(abortar_em_falha=False)
    if mapa == _BAIRRO_FALLBACK_MINIMO:
        print("[recuperar-localidade] ABORTANDO: mapa de bairros indisponivel.")
        return

    linhas, off = [], 0
    while True:
        lote = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&texto=not.is.null&localidade=eq.nao_identificado"
            f"&select=id,texto&limit=1000&offset={off}",
        )
        if not lote:
            break
        linhas.extend(lote)
        if len(lote) < 1000:
            break
        off += 1000

    achados = []
    for c in linhas:
        r = _bairro_no_texto(_norm(c.get("texto") or ""), mapa, TENANT)
        if r:
            achados.append((c, r[0], r[1]))

    print(f"[recuperar-localidade] {len(linhas)} linhas sem bairro conferidas.")
    if not achados:
        print("[recuperar-localidade] Nada a recuperar.")
        return

    print(f"[recuperar-localidade] {len(achados)} com bairro nomeado no texto:\n")
    for c, slug, alias in achados:
        print(f"  nao_identificado -> {slug}   (via {alias!r})")
        print(f"      {' '.join((c.get('texto') or '').split())[:170]}")
    if dry_run:
        print("\n[recuperar-localidade] --dry-run: nada gravado.")
        return

    ok = 0
    for c, slug, _ in achados:
        if _supabase_patch("comments", f"id=eq.{c['id']}&tenant=eq.{TENANT}",
                           {"localidade": slug}):
            ok += 1
    print(f"\n[recuperar-localidade] {ok}/{len(achados)} recuperados.")


def teste_localidade(limite=50):
    """Roda normalizar_localidade() sem chamar Claude e sem gravar nada.

    `--teste-localidade`     → regressao + varredura de 50 comentarios
    `--teste-localidade N`   → varre N
    `--teste-localidade 0`   → varre a base INTEIRA

    Duas partes:
      1. Casos com resposta esperada (_CASOS_LOCALIDADE) — teste de regressao
         da contaminacao de 27/07, em que "Centro de Testagem e Aconselhamento"
         virava o bairro Centro. E esta a parte que aprova ou reprova a build.
      2. Varredura da base, que procura DOIS erros de sinais opostos:
         contaminacao (bairro atribuido sem apoio no texto) e captura perdida
         (o texto nomeia um bairro e a linha ficou nao_identificado). O segundo
         existe para a correcao do primeiro nao virar excesso de zelo.

    Atencao ao que a parte 2 mede: ela le o TEXTO INTEIRO do comentario,
    enquanto a producao alimenta o valor curto que o modelo extraiu no campo
    `localidade`. Sao entradas diferentes, entao isto acha erro, mas nao e
    taxa de acerto de producao.
    """
    print("[teste-localidade] Carregando bairros...")
    mapa_bairros = carregar_bairros(abortar_em_falha=False)
    if mapa_bairros == _BAIRRO_FALLBACK_MINIMO:
        print("[teste-localidade] WARNING ALTO: fallback minimo em uso "
              "(leitura de public.bairros falhou ou banco vazio) — resultado nao e confiavel.")

    print(f"\n[teste-localidade] Casos com resposta esperada ({len(_CASOS_LOCALIDADE)}):\n")
    falhas = 0
    for valor, esperado in _CASOS_LOCALIDADE:
        obtido = normalizar_localidade(valor, mapa_bairros)
        ok = obtido == esperado
        falhas += 0 if ok else 1
        print(f"  {'ok  ' if ok else 'FALHOU'}  {valor!r:<58} -> {obtido}"
              f"{'' if ok else f'  (esperado {esperado})'}")
    print(f"\n[teste-localidade] {len(_CASOS_LOCALIDADE) - falhas}/{len(_CASOS_LOCALIDADE)} casos passaram.")
    if falhas:
        print("[teste-localidade] ATENCAO: ha caso falhando — nao subir para producao.")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[teste-localidade] SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.")
        return

    if limite == 0:
        print("\n[teste-localidade] Varrendo a base INTEIRA…")
    else:
        print(f"\n[teste-localidade] Varrendo {limite} comentários…")

    linhas, offset = [], 0
    while True:
        lote = _supabase_get(
            "comments",
            f"tenant=eq.{TENANT}&texto=not.is.null"
            f"&select=localidade,texto&limit=1000&offset={offset}",
        )
        if not lote:
            break
        linhas.extend(lote)
        if len(lote) < 1000 or (limite and len(linhas) >= limite):
            break
        offset += 1000
    if limite:
        linhas = linhas[:limite]
    if not linhas:
        print("[teste-localidade] Nenhum comentário com texto no Supabase.")
        return

    aliases_por_slug = {}
    for alias_norm, slug in mapa_bairros.items():
        aliases_por_slug.setdefault(slug, []).append(alias_norm)

    atribuidos = sem_apoio = 0
    possiveis_perdas = {}
    por_slug = {}
    for c in linhas:
        slug = (c.get("localidade") or "nao_identificado")
        texto = _norm(c.get("texto") or "")

        if slug != "nao_identificado":
            atribuidos += 1
            por_slug[slug] = por_slug.get(slug, 0) + 1
            aliases = aliases_por_slug.get(slug, [])
            apoio_direto = any(
                not _alias_extensivel(a) and _tem_termo(texto, a) for a in aliases
            )
            genericos = [a for a in aliases if _alias_extensivel(a)]
            if not apoio_direto and genericos and all(
                _so_em_composto(texto, a, TENANT) for a in genericos
            ):
                sem_apoio += 1
            continue

        # Marcado como nao_identificado: o texto nomeia um bairro de forma
        # inequivoca? Usa exatamente o mesmo julgamento da recuperacao — se a
        # varredura acusasse com um criterio e a recuperacao agisse com outro,
        # o relatorio contradiria a ferramenta que ele manda rodar.
        achado = _bairro_no_texto(texto, mapa_bairros, TENANT)
        if achado:
            possiveis_perdas[achado[0]] = possiveis_perdas.get(achado[0], 0) + 1

    total = len(linhas)
    print(f"\n[teste-localidade] {total} comentários com texto na base.")
    print(f"  com bairro atribuído : {atribuidos} ({round(atribuidos / total * 100)}%)")
    print(f"  nao_identificado     : {total - atribuidos} ({round((total - atribuidos) / total * 100)}%)")

    print("\n  Distribuição por bairro:")
    for s, n in sorted(por_slug.items(), key=lambda kv: -kv[1]):
        print(f"    {s:<20} {n}")

    print(f"\n  CONTAMINAÇÃO restante (bairro sem apoio no texto): {sem_apoio}")
    if sem_apoio:
        print("    Rode `python agora.py --reparar-localidade --dry-run` e leia os textos.")
    else:
        print("    Nenhuma. Todo bairro atribuído tem apoio no texto do comentário.")

    if possiveis_perdas:
        perdidos = sum(possiveis_perdas.values())
        print(f"\n  CAPTURA PERDIDA (texto nomeia bairro mas ficou nao_identificado): {perdidos}")
        for s, n in sorted(possiveis_perdas.items(), key=lambda kv: -kv[1])[:12]:
            print(f"    {s:<20} {n}")
        print("    Isto é o outro lado do erro: o filtro apertado demais também custa dado.")
    else:
        print("\n  CAPTURA PERDIDA: nenhuma detectada.")

    print("\n  Lembrete: esta varredura lê o TEXTO INTEIRO do comentário, enquanto a")
    print("  produção alimenta o valor curto que o modelo extraiu no campo `localidade`.")
    print("  Ela serve para achar contaminação e captura perdida, não como taxa de acerto.")


def reprocessar():
    """Busca os últimos 20 posts do Supabase e re-analisa com Claude (upsert).
    Não depende do Apify ter um run recente sem erros 429.
    Não coleta comentários novos; usa caption já gravado."""
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
    alertas ou coleta. Idempotente: rodar de novo so re-classifica.

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

    cliente = _cliente_anthropic()
    # 3 listas de formato HOMOGENEO — o PostgREST exige que todas as linhas de
    # um mesmo upsert em lote tenham exatamente as mesmas chaves (senao da
    # PGRST102 "All object keys must match" e o LOTE INTEIRO falha ao gravar,
    # incluindo linhas boas misturadas com as problematicas).
    rows_cidadao, rows_politico = [], []
    classificados_tot, pulados_tot, i_post = 0, 0, 0
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
        # Indice SEM resposta do Haiku (falha de infra: credito, rede, timeout) ->
        # PULA o comentario (nao grava default por cima de uma classificacao boa
        # que ja estava no banco). O backfill e idempotente — um proximo run
        # reprocessa este comentario do zero, entao nao ha perda permanente.
        for idx, c in enumerate(cidadaos):
            item = analise_por_i.get(idx)
            if not item:
                pulados_tot += 1
                continue
            tema_c = item.get("tema") or "outro"
            try:
                conf = int(item.get("confianca_tema") or 0)
            except (TypeError, ValueError):
                conf = 0
            sent = item.get("sentimento")
            rows_cidadao.append({
                "id": str(c.get("id", "")),
                "tema": tema_c,
                "subtema": normalizar_subtema(tema_c, item.get("subtema")),
                "localidade": normalizar_localidade(item.get("localidade"), mapa_bairros),
                "pedido": item.get("pedido") or None,
                "confianca_tema": conf,
                "autor_hash": hash_autor(TENANT, c.get("username", "")),
                # sentimento sempre presente (mesma forma em toda a lista) —
                # cai em 'neutro' apenas se o Haiku respondeu mas com um
                # valor fora do enum esperado (dado ruim, nao falha de infra).
                "sentimento": sent if sent in ("positivo", "negativo", "neutro") else "neutro",
            })
            classificados_tot += 1

        # Politicos: so autor_hash (LGPD), sem classificacao tematica.
        for c in coments:
            if (c.get("tipo") or "") != "cidadao":
                rows_politico.append({
                    "id": str(c.get("id", "")),
                    "autor_hash": hash_autor(TENANT, c.get("username", "")),
                })

        if i_post % 20 == 0:
            log(f"  ... {i_post}/{len(por_post)} posts processados")

    # Upsert em lotes de 500, uma chamada por formato (nunca mistura formatos)
    n_grav = 0
    for rows in (rows_cidadao, rows_politico):
        for k in range(0, len(rows), 500):
            n_grav += _supabase_upsert("comments", rows[k:k + 500], "id")
    log(f"  Backfill concluido: {n_grav} comentarios atualizados "
        f"({classificados_tot} cidadaos classificados pelo Haiku, "
        f"{pulados_tot} pulados por falha do Haiku — preservam valor anterior).")


if __name__ == "__main__":
    import sys

    def _arg_valor(nome: str) -> str | None:
        """Le `--flag valor` ou `--flag=valor` da linha de comando.

        Os outros modos leem so numeros soltos (`next(a for a in sys.argv if
        a.isdigit())`), o que nao serve para uma lista de UUIDs de estacao.
        """
        for i, a in enumerate(sys.argv):
            if a == nome and i + 1 < len(sys.argv):
                return sys.argv[i + 1]
            if a.startswith(nome + "="):
                return a.split("=", 1)[1]
        return None

    if "--multi-tenant" in sys.argv:
        main_multi_tenant()
    elif "--teste-sentimento" in sys.argv:
        # Reclassifica uma amostra real e compara com o gravado, sem escrever.
        # --teste-sentimento [N posts] [--tudo]
        _n = next((int(a) for a in sys.argv if a.isdigit()), 8)
        teste_sentimento(max_posts=_n)
    elif "--seguidores" in sys.argv:
        # Snapshot avulso dos contadores de seguidores (ranking da tela
        # "Analise por Perfil"), sem rodar o pipeline inteiro. Gratis por
        # padrao (Instagrapi); --com-apify libera o fallback pago para quando
        # a sessao do Instagram estiver bloqueada.
        gravar_metricas_perfis(permitir_apify="--com-apify" in sys.argv)
    elif "--amostra-rotulagem" in sys.argv:
        # --amostra-rotulagem [N]  -> N por estrato (default 100, total 300).
        # Gera a planilha cega de rotulagem humana. Custo zero.
        _n = 100
        for _a in sys.argv:
            if _a.isdigit():
                _n = int(_a)
        amostra_rotulagem(por_estrato=_n)
    elif "--medir-acuracia" in sys.argv:
        # --medir-acuracia rotulos.csv [gabarito.json]
        _args = [a for a in sys.argv[1:] if not a.startswith("--")]
        if not _args:
            print("uso: python agora.py --medir-acuracia rotulos.csv [gabarito_AAAAMMDD.json]")
        else:
            medir_acuracia(_args[0], _args[1] if len(_args) > 1 else None)
    elif "--teste-triagem" in sys.argv:
        # Mede o efeito de mexidas no PROMPT_TRIAGEM contra a base real.
        # Custo: so Anthropic (Haiku). Nao grava nada.
        _n = 6
        for _a in sys.argv:
            if _a.isdigit():
                _n = int(_a)
        _cat = ("imprensa" if "--imprensa" in sys.argv
                else "prefeit%" if "--governo" in sys.argv else "oposicao")
        teste_triagem(max_posts=_n, categoria=_cat)
    elif "--teste-tom" in sys.argv:
        # Mede o criterio de tom_publicacao contra a base real, sem escrever.
        # Custo: so Anthropic (Haiku). Sem categoria = amostra de todos.
        _n = next((int(a) for a in sys.argv if a.isdigit()), 20)
        _cat = ("imprensa" if "--imprensa" in sys.argv
                else "prefeit%" if "--governo" in sys.argv
                else "oposicao" if "--oposicao" in sys.argv else None)
        teste_tom(max_posts=_n, categoria=_cat)
    elif "--reclassificar-tom" in sys.argv:
        # Backfill de tom_publicacao na base existente. Idempotente: so pega
        # 'nao_classificado', a menos que venha --refazer. Custo: so Anthropic.
        _n = next((int(a) for a in sys.argv if a.isdigit()), 500)
        reclassificar_tom(limite=_n, dry_run="--dry-run" in sys.argv,
                          refazer="--refazer" in sys.argv)
    elif "--teste-filtro" in sys.argv:
        # --teste-filtro [N] [--resumo]  → N=0 varre a base inteira;
        # --resumo omite as captions e imprime so o placar por perfil.
        _lim = next((int(a) for a in sys.argv if a.isdigit()), 5)
        teste_filtro(limite=_lim, detalhar="--resumo" not in sys.argv)
    elif "--teste-localidade" in sys.argv:
        _n = next((int(a) for a in sys.argv if a.isdigit()), 50)
        teste_localidade(limite=_n)
    elif "--reparar-localidade" in sys.argv:
        # Desfaz bairro atribuido por nome composto ("Centro de Testagem").
        # So le texto ja gravado e aplica a regra corrigida: zero token.
        reparar_localidade(dry_run="--dry-run" in sys.argv)
    elif "--recuperar-localidade" in sys.argv:
        # Preenche bairro que o modelo deixou passar e o texto nomeia.
        # So le texto ja gravado: zero token.
        recuperar_localidade(dry_run="--dry-run" in sys.argv)
    elif "--teste-subtema" in sys.argv:
        # Dry-run: mostra o que o alerta de subtema dispararia (24h reais do
        # Supabase), sem enviar WhatsApp nem gravar historico.
        verificar_alerta_subtema(dry_run=True)
    elif "--testar-briefings-periodo" in sys.argv:
        # Gera so os briefings de semana/mes a partir do historico ja no
        # Supabase — zero coleta, zero credito Apify. Usa o mesmo caminho do
        # run normal (gerar_briefings_periodo), so sem o guard de horario.
        gerar_briefings_periodo()
    elif "--reparar-acentos-briefings" in sys.argv:
        # --reparar-acentos-briefings [N] [--dry-run]  → acentua os textos ja
        # gravados em ai_briefings (diagnostico, alertas, oportunidades,
        # recomendacoes). N limita as linhas mais recentes; sem N vai a base
        # inteira. Validador rejeita qualquer mudanca alem de diacriticos.
        # Custo: so Anthropic (Haiku, 1 chamada por linha), zero Apify.
        _n = next((int(a) for a in sys.argv if a.isdigit()), 0)
        reparar_acentos_briefings(dry_run="--dry-run" in sys.argv, limite=_n)
    elif "--backfill-comentarios" in sys.argv:
        # --backfill-comentarios [N]  → N opcional limita quantos comentarios (teste)
        _lim = None
        for _a in sys.argv:
            if _a.isdigit():
                _lim = int(_a)
        backfill_comentarios(limite=_lim)
    elif "--recalcular-sentimento" in sys.argv:
        # Reagrega comentarios_pct_pos/neg + sentimento_comentarios nos posts a
        # partir da tabela `comments`. Custo zero de creditos. Use --dry-run
        # para so imprimir o que mudaria, sem gravar.
        recalcular_sentimento_posts(dry_run="--dry-run" in sys.argv)
    elif "--reparar-sentimento-oposicao" in sys.argv:
        # Conserta comentario "positivo" em post de oposicao que so era apoio
        # ao opositor (achado em 30/07: variancia de amostragem, ver o
        # docstring de reparar_sentimento_oposicao). Custo: so Anthropic.
        reparar_sentimento_oposicao(dry_run="--dry-run" in sys.argv)
    elif "--expurgar-pii" in sys.argv:
        # --expurgar-pii [N] [--dry-run]  → apaga texto e @ do autor dos
        # comentarios com mais de N dias (default RETENCAO_PII_DIAS=180),
        # preservando a classificacao que alimenta os indices. Custo zero.
        _dias = None
        for _a in sys.argv:
            if _a.isdigit():
                _dias = int(_a)
        expurgar_pii(dias=_dias, dry_run="--dry-run" in sys.argv)
    elif "--reprocessar" in sys.argv:
        reprocessar()
    elif "--retroanalise" in sys.argv:
        main_retroanalise()
    elif "--teste-radio" in sys.argv:
        # Analisa transcricoes de radio JA gravadas e imprime as pautas, sem
        # escrever nada. O que olhar: se uma estacao so produz um tom, o modelo
        # esta deduzindo pelo microfone em vez de ler a fala.
        _n = next((int(a) for a in sys.argv if a.isdigit()), 3)
        teste_radio(limite=_n)
    elif "--radio-dry-run" in sys.argv or "--radio" in sys.argv:
        # Coleta de radio isolada. --radio-dry-run captura e loga sem gravar;
        # --radio grava. --agora ignora a faixa horaria do programa (teste
        # manual; em producao a janela e respeitada, senao o ator grava musica).
        if not _RADIO_OK:
            log("coletor_radio indisponivel (falha de import).")
        else:
            # --estacoes id1,id2 e --duracao N vem da gravacao sob demanda
            # pedida no painel (botao GRAVAR da Escuta do Radio), repassados
            # pelo workflow_dispatch do radio.yml.
            _ids = _arg_valor("--estacoes")
            _dur = _arg_valor("--duracao")
            # --aguardar N deixa o run DORMIR ate N minutos esperando a janela
            # de um programa abrir. E o antidoto ao atraso cronico do cron do
            # GitHub (medido em 03/08: +1h52 a +2h55): o radio.yml dispara
            # antes do horario e o coletor comeca a gravar na hora certa.
            _ag = _arg_valor("--aguardar")
            _radio.coletar_e_gravar(
                dry_run="--radio-dry-run" in sys.argv,
                ignorar_janela="--agora" in sys.argv,
                somente_ids=[i for i in (_ids or "").split(",") if i.strip()] or None,
                duracao_min=int(_dur) if (_dur or "").isdigit() else None,
                aguardar_min=int(_ag) if (_ag or "").isdigit() else 0,
            )
    elif "--adotar-radio" in sys.argv:
        # Grava o resultado de um run da Apify que JA terminou, mas cujo
        # resultado se perdeu (o coletor desistiu antes da hora, o job foi
        # abortado). A captacao e paga em tempo real: quando isso acontece, o
        # credito ja foi gasto e a transcricao esta pronta no dataset esperando
        # alguem le-la. Recuperavel enquanto o dado existir na Apify — a
        # retencao do plano e de 3 dias, a mesma que limita os clipes.
        # O run_id sai no log da propria desistencia.
        if not _RADIO_OK:
            log("coletor_radio indisponivel (falha de import).")
        else:
            _run = _arg_valor("--adotar-radio")
            if not _run:
                log("Uso: python agora.py --adotar-radio <run_id> [--dry-run]")
            else:
                _radio.adotar_run(_run, dry_run="--dry-run" in sys.argv)
    elif "--analisar-radio" in sys.argv:
        # Analisa e GRAVA as pautas dos blocos pendentes (sem coletar nada).
        # Usar depois de uma captura, ou para reprocessar com --refazer.
        _n = next((int(a) for a in sys.argv if a.isdigit()), 20)
        analisar_radio(limite=_n, dry_run="--dry-run" in sys.argv,
                       refazer="--refazer" in sys.argv)
    elif "--clipes-radio" in sys.argv:
        # Gera os clipes de audio das pautas que ainda nao tem, para os blocos
        # cujo audio ainda existe na Apify (retencao de 3 dias). Serve para
        # preencher retroativamente depois de uma analise que rodou sem ffmpeg.
        if not _RADIO_OK:
            log("coletor_radio indisponivel (falha de import).")
        else:
            import radio_analise as _ra
            import radio_clipes as _rc
            if not _rc.ffmpeg_disponivel():
                log("ffmpeg ausente nesta maquina — rode no GitHub Actions.")
            else:
                _n = next((int(a) for a in sys.argv if a.isdigit()), 10)
                _blocos = _supabase_get(
                    "radio_transcripts",
                    f"tenant=eq.{TENANT}&status=eq.SUCCESS&apify_run_id=not.is.null"
                    "&select=id,estacao,apify_run_id,audio_store_key,segments"
                    f"&order=inicio_ts.desc&limit={_n}",
                ) or []
                # --refazer regera clipe que ja existe: serve para corrigir
                # recorte antigo (o de antes de 30/07 nao era a frase citada).
                _refazer = "--refazer" in sys.argv
                _tot = 0
                for _b in _blocos:
                    log(f"  → {_b.get('estacao')}")
                    _tot += _ra._gravar_clipes(_b, refazer=_refazer)
                log(f"[radio] {_tot} clipe(s) de audio gerados em {len(_blocos)} bloco(s)")
    elif "--expurgar-radio" in sys.argv:
        # --expurgar-radio [N] [--dry-run] → apaga transcricao bruta e segmentos
        # das capturas com mais de N dias (default RETENCAO_RADIO_DIAS=90).
        _dias = next((int(a) for a in sys.argv if a.isdigit()), None)
        expurgar_pii_radio(dias=_dias, dry_run="--dry-run" in sys.argv)
    elif "--youtube-dry-run" in sys.argv or "--youtube" in sys.argv:
        # Coleta YouTube isolada. --youtube-dry-run busca da Apify e loga a
        # saida (inclui as chaves cruas p/ ajustar o mapeamento), sem gravar
        # nada. --youtube grava de verdade. Le so as fontes YouTube ativas de
        # `sources`; sem fonte ativa, retorna sem tocar na Apify.
        if not _YOUTUBE_OK:
            log("coletor_youtube indisponivel (falha de import).")
        else:
            _yt.coletar_e_gravar(dry_run="--youtube-dry-run" in sys.argv)
    else:
        # Producao (agora.yml roda "python agora.py" sem flags). Qualquer
        # excecao nao tratada dispara o alerta de suporte com o erro REAL
        # antes de propagar -- e o unico ponto que tem esse detalhe em maos;
        # o backstop do agora.yml (ver .github/workflows/agora.yml), que roda
        # se o processo for morto pelo timeout antes de chegar aqui, so
        # consegue um motivo generico. O marcador evita os dois alertarem em
        # dobro pro mesmo incidente quando o except abaixo E' alcancado.
        try:
            main()
        except Exception as _e:
            if _ALERTA_SUPORTE_OK:
                try:
                    _alerta.disparar("agora_py", f"{type(_e).__name__}: {_e}")
                    with open(".alerta_suporte_enviado", "w") as _f:
                        _f.write("1")
                except Exception as _e2:
                    log(f"  [alerta_suporte] falhou ao notificar ({_e2})")
            raise
