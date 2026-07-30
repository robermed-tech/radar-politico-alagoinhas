"""
Análise das transcrições de rádio — extrai as PAUTAS de cada bloco captado.

Entra uma transcrição de `radio_transcripts` (gravada pelo coletor_radio.py) e
saem linhas de `radio_topics`: assunto, resumo, citação com ponteiro para o
áudio, tema, localidade, se interessa à gestão e por quê, tom sobre a gestão,
voz de quem falou e pedido.

## Por que existe um portão antes do modelo

A rádio é quase toda música e publicidade. No primeiro teste real (5 min de
quatro estações) as 357 palavras da 93 FM eram letra de música, dedicatórias de
ouvinte e comercial de laboratório: zero conteúdo político. Mandar a transcrição
crua para o modelo seria pagar Haiku para classificar letra de música, e ainda
por cima convidá-lo a inventar juízo político onde não houve nenhum.

Então só sobem para o modelo as JANELAS que passam o mesmo critério de
relevância do resto do produto (as `relevance_keywords` do cliente mais as
âncoras do tenant). O critério não é reimplementado aqui: ele chega por injeção
no `Contexto.gate`, vindo do `agora.py::_motivo_relevancia`. Duplicar a regra
faria as duas cópias divergirem na primeira revisão, que é exatamente o que
aconteceu entre PROMPT_TRIAGEM e PROMPT_COMENTARIOS em 25/07.

A rádio é tratada como IMPRENSA no filtro: uma estação local cobre a região e
fala de outros municípios, que é a mesma razão pela qual a âncora do município
passou a ser exigida dos veículos.

## Por que a janela tem vizinhança

Segmento de Whisper tem poucos segundos. Um trecho isolado ("...e a prefeitura
não fez nada") chega ao modelo sem o assunto, e ele precisa adivinhar do que se
falava. A janela leva os segmentos vizinhos dentro de CONTEXTO_SEG, para o
modelo ler a fala inteira em vez de uma frase decepada.

## Por que o portão tem dois estágios

O critério de imprensa exige que a palavra genérica ("a prefeitura", "o
prefeito") venha acompanhada de uma âncora do município no MESMO texto. Isso é
correto para um post, que é autocontido, e errado para fala ao vivo: ninguém
repete o nome da cidade a cada frase, e "a prefeitura não recolheu o lixo essa
semana" seria descartado numa rádio local, onde é obviamente sobre aqui.

Então a decisão acontece em dois estágios, com a MESMA regra:

  1. `candidato` (qualquer keyword cadastrada) escolhe onde olhar — é só um
     localizador, e por isso é permissivo.
  2. `gate` (a regra inteira, com a exigência de âncora) decide sobre o TEXTO
     DA JANELA, ou seja, sobre a conversa de ~2 minutos em volta.

A âncora continua sendo exigida, e continua vindo da mesma função do agora.py:
o que muda é o tamanho do texto onde ela é procurada. Afrouxar a regra em si
traria de volta o problema que ela resolve, que é rádio regional comentando
outro município.

## Por que a citação nunca vale sozinha

Whisper alucina sobre música (no teste saiu "Suzy Allison Dance The Two Step" de
uma letra em inglês). Transcrição não é a palavra exata de ninguém: toda citação
sai com o instante (`ts_inicio`) para conferência no áudio, e a tela avisa que é
transcrição automática. Na dúvida sobre o instante, usa-se o início da janela em
vez de um número inventado.
"""

import json
import os
import re
import unicodedata
from datetime import datetime
from typing import Callable, NamedTuple

import requests

# Configuracao lida em TEMPO DE CHAMADA, e nao no import: o agora.py chama
# load_dotenv() DEPOIS de importar este modulo, entao constante lida no import
# fica vazia quando as credenciais vem de .env. O sintoma e cruel — escrita que
# retorna 0 sem erro nenhum — e so aparece na maquina do desenvolvedor, porque
# no GitHub Actions as variaveis sao de ambiente de verdade.

def _supabase() -> tuple[str, str]:
    return (os.environ.get("SUPABASE_URL", "").rstrip("/"),
            os.environ.get("SUPABASE_SERVICE_KEY", ""))


def _tenant() -> str:
    return os.environ.get("RADAR_TENANT", "alagoinhas")

# Segundos de contexto em volta do segmento que casou com a keyword.
CONTEXTO_SEG = 60

# Teto de caracteres por janela enviada ao modelo. Janela maior que isto é
# truncada: 6000 caracteres já são vários minutos de fala.
MAX_CHARS_JANELA = 6000

# Teto de janelas analisadas por bloco. Blindagem de custo: um programa
# inteiramente político geraria dezenas de chamadas. As janelas são ordenadas
# por tamanho (mais fala = mais conteúdo) antes do corte.
MAX_JANELAS_POR_BLOCO = 6

VOZES_VALIDAS = ("locutor", "ouvinte", "entrevistado", "reportagem")

# Confiança mínima para a pauta contar como crítica ou elogio. Mesmo valor e
# mesma política de CONFIANCA_MIN_TOM no agora.py: abaixo disso a pauta conta no
# total e em nenhum dos lados.
CONFIANCA_MIN_RADIO = 60


class Contexto(NamedTuple):
    """Dependências vindas do agora.py, para não duplicar regra nenhuma aqui.

    gate:        (texto) -> bool, o critério de relevância do tenant aplicado
                 sobre a JANELA (com exigência de âncora do município)
    candidato:   (texto) -> bool, localizador permissivo aplicado sobre o
                 SEGMENTO: "há alguma keyword cadastrada aqui?". Ver o cabeçalho
                 do módulo sobre os dois estágios.
    criterio_tom: o texto de CRITERIO_TOM_PUBLICACAO (fonte única das regras
                  de tom: portão, proibição de deduzir por lado, ironia, etc.)
    temas_validos: TEMAS_VALIDOS
    normalizar_localidade: (valor) -> slug de bairro ou ""
    """
    gate: Callable[[str], bool]
    candidato: Callable[[str], bool]
    criterio_tom: str
    temas_validos: frozenset
    normalizar_localidade: Callable[[str], str]


def _log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def _norm(txt: str) -> str:
    """Minúsculo e sem acento. Espelha agora.py::_norm."""
    s = unicodedata.normalize("NFD", str(txt or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


# ── Supabase REST (helpers próprios, padrão do coletor_youtube) ──────────────

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
                         headers=_sb_headers(), timeout=20)
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


def _supabase_patch(tabela: str, filtro: str, payload: dict) -> bool:
    url, key = _supabase()
    if not url or not key:
        return False
    try:
        r = requests.patch(f"{url}/rest/v1/{tabela}?{filtro}",
                           headers=_sb_headers({"Prefer": "return=minimal"}),
                           json=payload, timeout=30)
        return r.status_code in (200, 204)
    except Exception as e:
        _log(f"    Supabase PATCH {tabela}: erro {e}")
        return False


# ── Janelas (funções puras — testadas no __main__) ───────────────────────────

def _segmentos_ou_texto(transcricao: str, segments: list) -> list[dict]:
    """Normaliza a entrada: lista de {start, end, text}.

    Bloco sem `segments` (transcrição vinda de versão antiga do ator, ou falha
    na segmentação) vira um único segmento sem instante confiável. Perde-se o
    ponteiro para o áudio, não o conteúdo.
    """
    limpos = []
    for s in segments or []:
        texto = str(s.get("text") or "").strip()
        if not texto:
            continue
        try:
            ini = float(s.get("start") or 0)
            fim = float(s.get("end") or ini)
        except (TypeError, ValueError):
            ini = fim = 0.0
        limpos.append({"start": ini, "end": fim, "text": texto})
    if limpos:
        return limpos
    texto = str(transcricao or "").strip()
    return [{"start": 0.0, "end": 0.0, "text": texto}] if texto else []


def montar_janelas(transcricao: str, segments: list, gate: Callable[[str], bool],
                   contexto_seg: int = CONTEXTO_SEG,
                   candidato: Callable[[str], bool] | None = None) -> list[dict]:
    """Junta em janelas os trechos que falam da gestão, com vizinhança.

    Dois estágios (ver cabeçalho do módulo): `candidato` localiza o segmento e
    `gate` aprova a janela. Sem `candidato`, o próprio `gate` localiza — é o que
    os testes usam quando o assunto do teste não é a âncora.

    Devolve [{ts_inicio, ts_fim, texto}] ordenado pelo tempo. Janelas que se
    encostam são fundidas: duas menções à mesma obra separadas por 20 s são uma
    conversa, não duas pautas, e mandá-las em chamadas separadas produziria
    pauta duplicada.
    """
    segs = _segmentos_ou_texto(transcricao, segments)
    if not segs:
        return []

    localizar = candidato or gate
    marcados = [i for i, s in enumerate(segs) if localizar(s["text"])]
    if not marcados:
        return []

    # Intervalos de tempo cobertos por cada acerto, já com a vizinhança.
    intervalos = []
    for i in marcados:
        ini = segs[i]["start"] - contexto_seg
        fim = segs[i]["end"] + contexto_seg
        if intervalos and ini <= intervalos[-1][1]:
            intervalos[-1][1] = max(intervalos[-1][1], fim)
        else:
            intervalos.append([ini, fim])

    janelas = []
    for ini, fim in intervalos:
        dentro = [s for s in segs if s["end"] >= ini and s["start"] <= fim]
        if not dentro:
            continue
        texto = " ".join(s["text"] for s in dentro).strip()
        # Segundo estágio: a regra inteira decide sobre a conversa. Janela que
        # só tem a palavra genérica e nenhuma âncora do município na vizinhança
        # é notícia de outra cidade, e não sobe para o modelo.
        if not gate(texto):
            continue
        janelas.append({
            "ts_inicio": max(0.0, round(dentro[0]["start"], 2)),
            "ts_fim":    round(dentro[-1]["end"], 2),
            "texto":     texto[:MAX_CHARS_JANELA],
        })
    return janelas


def priorizar_janelas(janelas: list[dict], maximo: int = MAX_JANELAS_POR_BLOCO) -> list[dict]:
    """Corta o excedente pelas MAIORES janelas, devolvendo em ordem de tempo.

    Cortar pelas primeiras seria pior: um programa que só fala de política no
    fim perderia justamente o miolo. Tamanho é a única proxy de conteúdo
    disponível antes de chamar o modelo.
    """
    if len(janelas) <= maximo:
        return janelas
    maiores = sorted(janelas, key=lambda j: len(j["texto"]), reverse=True)[:maximo]
    return sorted(maiores, key=lambda j: j["ts_inicio"])


def ts_da_citacao(segments: list, citacao: str, padrao: float) -> float:
    """Instante em que a citação começa, achado no segmento que a contém.

    Cai para `padrao` (o início da janela) quando não acha. Nunca interpola nem
    estima: instante errado num alerta enviado a secretário é pior que instante
    aproximado do começo da conversa, porque o secretário vai conferir no áudio.
    """
    alvo = _norm(citacao).strip()
    if not alvo:
        return padrao
    # Compara por um trecho inicial: o modelo costuma reproduzir a citação com
    # pontuação levemente diferente do segmento.
    prefixo = " ".join(alvo.split()[:6])
    if not prefixo:
        return padrao
    for s in segments or []:
        if prefixo and prefixo in _norm(s.get("text") or ""):
            try:
                return round(float(s.get("start") or padrao), 2)
            except (TypeError, ValueError):
                return padrao
    return padrao


# ── Prompt ───────────────────────────────────────────────────────────────────

def montar_prompt(ctx: Contexto) -> str:
    """Monta o system prompt, interpolando o critério de tom do agora.py.

    O critério de tom NÃO é reescrito aqui: é o mesmo texto que classifica o tom
    das publicações (portão de juízo sobre a gestão, proibição de deduzir pelo
    lado, ironia exige contradição no texto, cobrança sem reprovação é neutro).
    Reescrever produziria duas doutrinas divergentes sobre a mesma pergunta.
    """
    temas = "|".join(sorted(ctx.temas_validos))
    return (
        "Voce analisa a transcricao automatica de um trecho de programa de RADIO "
        "de Alagoinhas/BA. O objetivo e medir como esta a imagem da prefeitura, "
        "do prefeito Gustavo Carmo e da gestao municipal junto a populacao.\n\n"
        "A transcricao e automatica (Whisper) e contem erro de palavra, nome "
        "trocado e trecho de musica ou publicidade no meio. Trabalhe com o que "
        "esta claro; ignore o que estiver ininteligivel em vez de adivinhar.\n\n"
        "TAREFA: liste as PAUTAS do trecho, uma por assunto debatido. Um bloco "
        "de radio mistura varios assuntos; nao resuma tudo num item so, e nao "
        "invente pauta a partir de musica, vinheta, previsao do tempo, "
        "publicidade ou recado de ouvinte que so manda abraco.\n\n"
        "PARA CADA PAUTA:\n"
        "  assunto          = titulo curto (ate 60 caracteres)\n"
        "  resumo           = 2 a 4 frases sobre o que foi dito\n"
        "  citacao          = trecho LITERAL da transcricao, ate 200 caracteres, "
        "copiado sem reescrever. Nao parafrasear: a citacao e conferida no audio.\n"
        f"  tema             = um de: {temas}. Use vazio se nenhum servir.\n"
        "  localidade       = bairro, povoado, praca ou rua citado. Nome de "
        "equipamento ou programa (posto, CTA, hospital, UPA, escola, creche, "
        "secretaria) NAO e localidade. Vazio se nao houver.\n"
        "  interesse_gestao = true SO se a pauta afeta a imagem, a cobranca ou a "
        "operacao da prefeitura de Alagoinhas. Noticia nacional, esporte, "
        "policial sem envolvimento da gestao, novela e horoscopo = false.\n"
        "  motivo_interesse = por que interessa ao prefeito e a gestao, em uma "
        "frase concreta. Vazio quando interesse_gestao = false.\n"
        "  voz              = quem falou: 'locutor' (apresentador/comentarista), "
        "'ouvinte' (quem ligou, mandou audio ou mensagem), 'entrevistado' "
        "(convidado, autoridade, tecnico) ou 'reportagem' (leitura de materia). "
        "Na duvida entre locutor e ouvinte, escolha pelo que o texto mostra; nao "
        "chute.\n"
        "  pedido           = demanda concreta pedida no ar (ex: 'tapar buraco na "
        "rua X'), vazio se nao houver.\n"
        "  score_risco      = 0-100, risco para a imagem da gestao.\n"
        "  urgencia         = 'baixa' | 'media' | 'alta'.\n"
        "  confianca        = 0-100 na leitura desta pauta. Baixe abaixo de 60 "
        "quando a transcricao estiver truncada, confusa ou o assunto aparecer de "
        "forma lateral. Preferir confianca baixa a inventar interpretacao.\n\n"
        "TOM SOBRE A GESTAO (campo 'tom_sobre_gestao') segue exatamente o "
        "criterio abaixo, com uma unica adaptacao: onde o criterio fala da "
        "'publicacao', leia 'a fala no radio'.\n"
        + ctx.criterio_tom +
        "\n\nDUAS REGRAS ESPECIFICAS DE RADIO:\n"
        "1. NAO DEDUZA O TOM PELA ESTACAO NEM PELO LOCUTOR. Radio com "
        "apresentador critico tambem noticia entrega de obra, e radio simpatica a "
        "gestao tambem le reclamacao de ouvinte. Quem decide e a fala, nunca de "
        "quem e o microfone.\n"
        "2. RECADO E DEDICATORIA NAO SAO PAUTA. 'Boa tarde para o Diego ali na "
        "Rua da Usina' e recado de ouvinte, nao demanda nem opiniao sobre a "
        "gestao: nao gere pauta a partir disso.\n\n"
        "NAO use travessao (—) em nenhum texto que voce escrever.\n\n"
        'Retorne APENAS JSON valido, sem markdown: '
        '{"pautas":[{"assunto":"","resumo":"","citacao":"","tema":"",'
        '"localidade":"","interesse_gestao":false,"motivo_interesse":"",'
        '"tom_sobre_gestao":"critico|favoravel|neutro","voz":"locutor",'
        '"pedido":"","score_risco":0,"urgencia":"baixa","confianca":0}]}\n'
        "Trecho sem nenhuma pauta relevante: retorne {\"pautas\":[]}."
    )


def _parse_json_resposta(texto: str):
    """Remove bloco markdown e faz parse do JSON. Espelha agora.py."""
    texto = (texto or "").strip()
    if texto.startswith("```"):
        texto = texto.split("```")[1]
        if texto.startswith("json"):
            texto = texto[4:]
    return json.loads(texto.strip())


def _limpar_travessao(txt: str) -> str:
    """Rede de seguranca do criterio de texto do projeto: nenhum travessao chega
    ao banco, mesmo que o modelo desobedeca ao prompt."""
    return re.sub(r"\s*[—–]\s*", ", ", str(txt or "")).strip()


def normalizar_pauta(bruta: dict, janela: dict, segments: list, ctx: Contexto) -> dict | None:
    """Valida e normaliza uma pauta devolvida pelo modelo.

    Devolve None sem `assunto`: linha sem assunto nao diz nada na tela e ainda
    ocuparia espaco no rank. Todo campo fora do vocabulario valido cai para o
    valor de "nao medido", nunca para o valor mais provavel.
    """
    assunto = _limpar_travessao(bruta.get("assunto"))[:120]
    if not assunto:
        return None

    tema = _norm(bruta.get("tema") or "").strip()
    if tema not in ctx.temas_validos:
        tema = None

    tom = str(bruta.get("tom_sobre_gestao") or "").strip().lower()
    if tom not in ("critico", "favoravel", "neutro"):
        tom = "nao_classificado"

    voz = str(bruta.get("voz") or "").strip().lower()
    voz = voz if voz in VOZES_VALIDAS else None

    def _inteiro(valor, teto=100):
        try:
            return max(0, min(teto, int(float(valor or 0))))
        except (TypeError, ValueError):
            return 0

    citacao = _limpar_travessao(bruta.get("citacao"))[:300]
    localidade = ctx.normalizar_localidade(str(bruta.get("localidade") or "")) or None

    urgencia = str(bruta.get("urgencia") or "").strip().lower()
    urgencia = urgencia if urgencia in ("baixa", "media", "alta") else None

    interesse = bool(bruta.get("interesse_gestao"))
    motivo = _limpar_travessao(bruta.get("motivo_interesse"))[:400]

    return {
        "assunto":          assunto,
        "resumo":           _limpar_travessao(bruta.get("resumo"))[:1200] or None,
        "citacao":          citacao or None,
        "ts_inicio":        ts_da_citacao(segments, citacao, janela["ts_inicio"]),
        "ts_fim":           janela["ts_fim"],
        "tema":             tema,
        "localidade":       localidade,
        # Sem motivo, o "interesse" nao e verificavel por quem le a tela — e a
        # pergunta do cliente e "por que interessa". Interesse sem porque volta
        # a ser false em vez de aparecer como afirmacao sem lastro.
        "interesse_gestao": interesse and bool(motivo),
        "motivo_interesse": motivo or None,
        "tom_sobre_gestao": tom,
        "voz":              voz,
        "pedido":           _limpar_travessao(bruta.get("pedido"))[:300] or None,
        "score_risco":      _inteiro(bruta.get("score_risco")),
        "urgencia":         urgencia,
        "confianca":        _inteiro(bruta.get("confianca")),
    }


def analisar_janela(janela: dict, segments: list, ctx: Contexto, cliente, modelo: str) -> list[dict] | None:
    """Uma chamada ao modelo para uma janela.

    Devolve as pautas normalizadas, ou **None quando a chamada FALHOU**. A
    distinção importa: lista vazia é "o modelo leu e não achou pauta", e None é
    "o modelo não leu". A primeira versão devolvia [] nos dois casos, e o
    chamador marcava o bloco como analisado de qualquer jeito — foi assim que
    uma captação paga de 15 min ficou com zero pautas e sem chance de ser
    reprocessada, quando a API da Anthropic recusou por falta de credito.
    """
    try:
        r = cliente.messages.create(
            model=modelo,
            max_tokens=2000,
            system=montar_prompt(ctx),
            messages=[{"role": "user", "content":
                       f"Trecho transcrito (instante {janela['ts_inicio']:.0f}s a "
                       f"{janela['ts_fim']:.0f}s):\n{janela['texto']}"}],
        )
        dados = _parse_json_resposta(r.content[0].text)
    except Exception as e:
        _log(f"      analise da janela falhou ({e})")
        return None

    pautas = []
    for bruta in (dados.get("pautas") or []):
        if not isinstance(bruta, dict):
            continue
        p = normalizar_pauta(bruta, janela, segments, ctx)
        if p:
            pautas.append(p)
    return pautas


# ── Orquestração ─────────────────────────────────────────────────────────────

def _blocos_pendentes(limite: int, tenant: str = None, refazer: bool = False) -> list[dict]:
    """Blocos captados com sucesso e ainda não analisados.

    Bloco com falha de captura fica de fora: não tem transcrição para analisar,
    e a linha dele existe justamente para a tela poder dizer "não captada".
    """
    filtro = (f"tenant=eq.{tenant or _tenant()}&status=eq.SUCCESS"
              "&transcricao=not.is.null"
              "&select=id,estacao,programa,inicio_ts,transcricao,segments"
              f"&order=inicio_ts.desc&limit={limite}")
    if not refazer:
        filtro += "&analisado_em=is.null"
    return _supabase_get("radio_transcripts", filtro)


def analisar_pendentes(ctx: Contexto, cliente, modelo: str, limite: int = 20,
                       dry_run: bool = False, refazer: bool = False) -> dict:
    """Analisa os blocos pendentes e grava as pautas.

    Idempotente: só pega bloco com `analisado_em` nulo (a menos de --refazer), e
    marca depois de gravar. Bloco captado que não tinha nenhuma janela relevante
    também é marcado como analisado, senão seria reprocessado a cada execução
    para chegar sempre à mesma conclusão.
    """
    blocos = _blocos_pendentes(limite, refazer=refazer)
    if not blocos:
        _log("[radio] Nenhum bloco pendente de analise")
        return {"blocos": 0, "pautas": 0, "chamadas": 0}

    _log(f"=== Analise de radio — {len(blocos)} bloco(s) pendente(s)"
         f"{' [DRY-RUN]' if dry_run else ''} ===")
    total_pautas, total_chamadas = 0, 0

    for bloco in blocos:
        segments = bloco.get("segments") or []
        janelas = montar_janelas(bloco.get("transcricao") or "", segments, ctx.gate,
                                 candidato=ctx.candidato)
        janelas = priorizar_janelas(janelas)
        _log(f"  → {bloco['estacao']} ({bloco['inicio_ts'][:16]}): "
             f"{len(janelas)} janela(s) relevante(s)")

        linhas = []
        falhas = 0
        for janela in janelas:
            total_chamadas += 1
            pautas_janela = analisar_janela(janela, segments, ctx, cliente, modelo)
            if pautas_janela is None:
                falhas += 1
                continue
            for p in pautas_janela:
                p.update({
                    "tenant":        _tenant(),
                    "transcript_id": bloco["id"],
                    "estacao":       bloco["estacao"],
                    "programa":      bloco.get("programa"),
                    "captado_em":    bloco["inicio_ts"],
                })
                linhas.append(p)

        if dry_run:
            for l in linhas:
                marca = "★" if l["interesse_gestao"] else " "
                _log(f"    {marca} [{l['tom_sobre_gestao']:>16}] [{l['voz'] or 'voz?'}] "
                     f"{l['assunto']}  (conf {l['confianca']}, {l['ts_inicio']:.0f}s)")
                if l["motivo_interesse"]:
                    _log(f"        por que: {l['motivo_interesse']}")
            total_pautas += len(linhas)
            continue

        if linhas:
            total_pautas += _supabase_upsert("radio_topics", linhas,
                                             "transcript_id,ts_inicio,assunto")

        if falhas:
            # Bloco com janela que o modelo não conseguiu ler SEGUE PENDENTE.
            # Marcá-lo aqui transformaria uma falha de infraestrutura (sem
            # crédito, timeout, rate limit) em "analisado e nada relevante", e o
            # áudio já foi pago: só o reprocessamento recupera o valor dele. O
            # upsert de radio_topics é idempotente (transcript_id, ts_inicio,
            # assunto), então reanalisar não duplica o que já entrou.
            _log(f"    {falhas} de {len(janelas)} janela(s) falharam — bloco segue "
                 f"pendente para a próxima rodada")
            continue

        # Marca o bloco mesmo sem pauta: "analisado e nada relevante" é
        # resultado, não pendência.
        _supabase_patch("radio_transcripts", f"id=eq.{bloco['id']}", {
            "analisado_em": datetime.now().isoformat(),
            "janelas_relevantes": len(janelas),
        })

    _log(f"[radio] {total_pautas} pauta(s) de {len(blocos)} bloco(s), "
         f"{total_chamadas} chamada(s) ao modelo")
    return {"blocos": len(blocos), "pautas": total_pautas, "chamadas": total_chamadas}


def teste_radio(ctx: Contexto, cliente, modelo: str, limite: int = 3) -> None:
    """Harness: analisa blocos já gravados SEM escrever nada.

    O que olhar no resultado: se toda pauta de uma estação sair 'critico' e
    toda de outra sair 'favoravel', o modelo está lendo o microfone em vez do
    conteúdo. É o mesmo teste que --teste-tom faz por perfil.
    """
    blocos = _blocos_pendentes(limite, refazer=True)
    if not blocos:
        _log("[radio] Nenhuma transcricao gravada para testar. "
             "Rode a coleta antes (python coletor_radio.py --dry-run mostra sem gravar).")
        return

    placar: dict[str, dict[str, int]] = {}
    for bloco in blocos:
        segments = bloco.get("segments") or []
        transcricao = bloco.get("transcricao") or ""
        janelas = priorizar_janelas(montar_janelas(transcricao, segments, ctx.gate,
                                                   candidato=ctx.candidato))
        palavras = len(transcricao.split())
        _log(f"\n  ── {bloco['estacao']} | {bloco['inicio_ts'][:16]} | "
             f"{palavras} palavras | {len(janelas)} janela(s) relevante(s)")
        if not janelas:
            _log("     (nenhum trecho citou a gestao — nada enviado ao modelo)")
            continue
        for janela in janelas:
            _log(f"     · janela {janela['ts_inicio']:.0f}s-{janela['ts_fim']:.0f}s "
                 f"({len(janela['texto'])} chars)")
            for p in analisar_janela(janela, segments, ctx, cliente, modelo):
                baixa = "" if p["confianca"] >= CONFIANCA_MIN_RADIO else " (confianca baixa)"
                marca = "★ interessa" if p["interesse_gestao"] else "  "
                _log(f"       {marca} [{p['tom_sobre_gestao']}] [{p['voz'] or 'voz?'}] "
                     f"{p['assunto']}{baixa}")
                if p["citacao"]:
                    _log(f"           \"{p['citacao'][:120]}\" ({p['ts_inicio']:.0f}s)")
                if p["confianca"] >= CONFIANCA_MIN_RADIO:
                    est = placar.setdefault(bloco["estacao"], {})
                    est[p["tom_sobre_gestao"]] = est.get(p["tom_sobre_gestao"], 0) + 1

    if placar:
        _log("\n  Placar por estacao (so pautas confiantes):")
        for estacao, toms in placar.items():
            detalhe = ", ".join(f"{k}={v}" for k, v in sorted(toms.items()))
            _log(f"    {estacao}: {detalhe}")
        _log("  Se uma estacao so produz um tom, suspeite de deducao pelo microfone.")


# ── Autoteste das funções puras ──────────────────────────────────────────────

def _autoteste() -> None:
    """Zero rede, zero token: testa janelas, instante e normalização."""
    segs = [
        {"start": 0,   "end": 10,  "text": "93FM so sucesso, a musica que voce pediu"},
        {"start": 30,  "end": 40,  "text": "Quando voce me aguarda eu posso dancar"},
        {"start": 100, "end": 110, "text": "Boa tarde para Diego ali na Rua da Usina"},
        {"start": 200, "end": 215, "text": "A prefeitura de Alagoinhas prometeu asfaltar e nao apareceu"},
        {"start": 216, "end": 230, "text": "Ouvinte reclama que esta ha tres dias sem agua"},
        {"start": 600, "end": 610, "text": "Agora o segundo lugar nas mais pedidas"},
    ]

    # Gate de teste: exige a âncora do município junto da palavra genérica,
    # imitando a regra da imprensa.
    def gate(texto: str) -> bool:
        t = _norm(texto)
        return "prefeitura" in t and "alagoinhas" in t

    janelas = montar_janelas("", segs, gate)
    assert len(janelas) == 1, janelas
    # A vizinhança de 60 s trouxe o segmento seguinte (o "sem agua"), que é a
    # continuação da conversa, e não trouxe a música do minuto 10.
    assert "sem agua" in janelas[0]["texto"]
    assert "so sucesso" not in janelas[0]["texto"]
    # O recado dos 100 s está 90 s antes do trecho marcado: fora da vizinhança
    # de 60 s, e por isso a janela começa na própria fala sobre a prefeitura.
    assert janelas[0]["ts_inicio"] == 200
    assert "Rua da Usina" not in janelas[0]["texto"]

    # Nada relevante → nenhuma janela → nenhuma chamada ao modelo.
    assert montar_janelas("", segs, lambda t: False) == []

    # Duas conversas distantes viram duas janelas; próximas, uma só.
    longe = [
        {"start": 0,    "end": 10,   "text": "prefeitura de alagoinhas obra"},
        {"start": 2000, "end": 2010, "text": "prefeitura de alagoinhas saude"},
    ]
    assert len(montar_janelas("", longe, gate)) == 2
    perto = [
        {"start": 0,  "end": 10, "text": "prefeitura de alagoinhas obra"},
        {"start": 30, "end": 40, "text": "prefeitura de alagoinhas saude"},
    ]
    assert len(montar_janelas("", perto, gate)) == 1

    # Bloco sem segments: usa o texto inteiro, sem instante confiável.
    sem_seg = montar_janelas("a prefeitura de alagoinhas nao resolveu", [], gate)
    assert len(sem_seg) == 1 and sem_seg[0]["ts_inicio"] == 0.0

    # ── Portão de dois estágios ──
    # O caso que motivou o desenho: o locutor diz "a prefeitura" sem repetir o
    # nome da cidade, e a âncora aparece na conversa em volta. Com a regra
    # aplicada só ao segmento, essa fala legítima seria descartada.
    def candidato(texto: str) -> bool:
        return "prefeitura" in _norm(texto)

    fala_local = [
        {"start": 0,  "end": 8,  "text": "Aqui em Alagoinhas a semana comecou movimentada"},
        {"start": 10, "end": 20, "text": "A prefeitura nao recolheu o lixo essa semana"},
    ]
    js2 = montar_janelas("", fala_local, gate, candidato=candidato)
    assert len(js2) == 1, js2
    assert "lixo" in js2[0]["texto"]

    # E o contrário continua valendo: palavra genérica sem nenhuma âncora na
    # vizinhança é notícia de outro município e não sobe para o modelo. É a
    # regra da imprensa intacta, só medida num texto maior.
    fala_de_fora = [
        {"start": 0,  "end": 8,  "text": "Em Catu o clima politico esquentou"},
        {"start": 10, "end": 20, "text": "A prefeitura nao recolheu o lixo essa semana"},
    ]
    assert montar_janelas("", fala_de_fora, gate, candidato=candidato) == []

    # Priorização mantém ordem temporal e corta as menores.
    js = [{"ts_inicio": i * 100, "ts_fim": i * 100 + 10, "texto": "x" * (10 - i)}
          for i in range(8)]
    prio = priorizar_janelas(js, maximo=3)
    assert len(prio) == 3
    assert [j["ts_inicio"] for j in prio] == sorted(j["ts_inicio"] for j in prio)
    assert prio[0]["ts_inicio"] == 0  # a maior é a primeira, e segue em ordem

    # Instante da citação: acha o segmento, e cai no padrão quando não acha.
    assert ts_da_citacao(segs, "A prefeitura de Alagoinhas prometeu asfaltar", 0) == 200
    assert ts_da_citacao(segs, "frase que nao existe no audio", 42) == 42
    assert ts_da_citacao(segs, "", 42) == 42

    # ── Normalização ──
    ctx = Contexto(gate=gate, candidato=candidato, criterio_tom="",
                   temas_validos=frozenset({"obras", "saude"}),
                   normalizar_localidade=lambda v: _norm(v).replace(" ", "_"))
    janela = {"ts_inicio": 200.0, "ts_fim": 230.0, "texto": "..."}

    p = normalizar_pauta({
        "assunto": "Asfalto prometido e nao entregue",
        "resumo": "Locutor cobra a prefeitura pelo asfalto",
        "citacao": "A prefeitura de Alagoinhas prometeu asfaltar e nao apareceu",
        "tema": "obras", "localidade": "Riacho da Guia",
        "interesse_gestao": True, "motivo_interesse": "cobranca direta a gestao no ar",
        "tom_sobre_gestao": "critico", "voz": "locutor", "pedido": "asfaltar a rua",
        "score_risco": 70, "urgencia": "alta", "confianca": 85,
    }, janela, segs, ctx)
    assert p["ts_inicio"] == 200          # veio do segmento, não da janela
    assert p["tema"] == "obras"
    assert p["localidade"] == "riacho_da_guia"
    assert p["interesse_gestao"] is True

    # Sem assunto não vira linha.
    assert normalizar_pauta({"resumo": "algo"}, janela, segs, ctx) is None

    # Vocabulário inválido cai para "não medido", nunca para o valor provável.
    ruim = normalizar_pauta({"assunto": "X", "tema": "novela", "tom_sobre_gestao": "ruim",
                             "voz": "narrador", "urgencia": "urgentissima",
                             "score_risco": "abc", "confianca": 999},
                            janela, segs, ctx)
    assert ruim["tema"] is None
    assert ruim["tom_sobre_gestao"] == "nao_classificado"
    assert ruim["voz"] is None
    assert ruim["urgencia"] is None
    assert ruim["score_risco"] == 0
    assert ruim["confianca"] == 100       # teto aplicado, não descartado

    # Interesse sem o porquê não se sustenta na tela: volta a false.
    sem_motivo = normalizar_pauta({"assunto": "X", "interesse_gestao": True},
                                 janela, segs, ctx)
    assert sem_motivo["interesse_gestao"] is False

    # Travessão nunca chega ao banco, mesmo se o modelo desobedecer.
    com_travessao = normalizar_pauta(
        {"assunto": "Obra parada — bairro reclama", "resumo": "a — b"},
        janela, segs, ctx)
    assert "—" not in com_travessao["assunto"]
    assert "—" not in com_travessao["resumo"]

    print("radio_analise: autoteste OK")


if __name__ == "__main__":
    _autoteste()
