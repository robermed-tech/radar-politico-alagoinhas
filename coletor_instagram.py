"""
Coletor Instagram via Instagrapi — substituto gratuito do Apify.

Responsabilidades:
  - Login com persistência de sessão (evita re-login a cada execução)
  - Coleta posts recentes de múltiplos perfis
  - Coleta comentários por URL de post
  - Retorna dados no MESMO formato do Apify (pipeline não precisa mudar)
  - Suporte a proxy residencial (Webshare) para evitar bloqueios de IP

Variáveis de ambiente necessárias (.env):
  IG_USERNAME    = seu_usuario_instagram
  IG_PASSWORD    = sua_senha_instagram
  IG_SESSION_FILE = ig_session.json  (opcional, padrão: ig_session.json)

  # Proxy Webshare (opcional mas recomendado)
  IG_PROXY = http://usuario:senha@proxy.webshare.io:80

Boas práticas anti-ban:
  - Sessão é salva e reutilizada (evita login frequente)
  - Sleep aleatório entre perfis (1–3s)
  - Limite de 20 posts/perfil e 200 comentários/post
  - Em caso de erro por perfil, continua os demais
  - Proxy residencial rotativo reduz risco de bloqueio a quase zero
"""

import os
import json
import re
import time
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from instagrapi import Client
    from instagrapi.exceptions import UserNotFound, MediaNotFound, RateLimitError
    INSTAGRAPI_DISPONIVEL = True
except ImportError:
    INSTAGRAPI_DISPONIVEL = False


# ── Configurações ──────────────────────────────────────────────────────────────

IG_USERNAME     = os.environ.get("IG_USERNAME", "")
IG_PASSWORD     = os.environ.get("IG_PASSWORD", "")
IG_SESSION_FILE = os.environ.get("IG_SESSION_FILE", "ig_session.json")
IG_PROXY        = os.environ.get("IG_PROXY", "")
IG_SESSION_JSON = os.environ.get("IG_SESSION_JSON", "")  # sessão serializada (GitHub Actions)

POSTS_POR_PERFIL   = 20    # máximo de posts por perfil
COMENTARIOS_POR_POST = 200 # máximo de comentários por post
DIAS_ATRAS         = 2     # coleta posts dos últimos N dias
SLEEP_ENTRE_PERFIS = (1.0, 3.0)   # segundos (min, max) entre perfis
SLEEP_ENTRE_POSTS  = (0.5, 1.5)   # segundos entre coletas de comentário
LIMIAR_BLOQUEIO_CONSECUTIVO = 2   # "429 esgotado" seguidos antes de desistir do lote


# ── Login e sessão ─────────────────────────────────────────────────────────────

# Desativa proxy no Actions APENAS se IG_PROXY não estiver configurado.
# O problema anterior (407) era do HTTPS_PROXY global no workflow, não do proxy do Instagrapi.
_NO_PROXY = bool(os.environ.get("GITHUB_ACTIONS")) and not IG_PROXY


def _novo_cliente(usar_proxy: bool = True) -> "Client":
    cl = Client()
    cl.delay_range = [1, 3]
    if usar_proxy and IG_PROXY and not _NO_PROXY:
        cl.set_proxy(IG_PROXY)
        print(f"  ✓ Proxy: {IG_PROXY.split('@')[-1]}")
    elif _NO_PROXY:
        print("  ℹ GitHub Actions sem proxy configurado")
    return cl


class SessaoInvalida(RuntimeError):
    """Sessao carregada mas recusada pelo Instagram. Quem chama trata como
    'Instagrapi indisponivel neste run' e deixa a Apify assumir."""


# `criar_cliente` e chamado uma vez por modulo (posts, comentarios, perfis).
# Sem esta memoria, a sessao morta seria checada tres vezes por run e o alerta
# tentado tres vezes — a dedup do alerta_suporte cobre o segundo caso, mas a
# requisicao extra e desperdicio.
_SESSAO_JA_RECUSADA = False


def _sessao_viva(cl) -> bool:
    """Uma chamada AUTENTICADA para saber se a sessao carregada vale alguma coisa.

    `set_settings` so desserializa cookies e dados de dispositivo — ele nao fala
    com o Instagram. Por isso o log dizia "Sessao carregada" desde sempre: era
    "arquivo lido", nao "autenticado". A sessao de 22/06 estava morta havia
    meses e ninguem soube, porque o efeito era invisivel: v1 respondia
    LoginRequired, tudo caia no endpoint publico, o publico devolvia 429, a
    Apify assumia e o run saia VERDE. Custo medido em 01/09/26: ~US$ 17/mes de
    Apify (58% do teto) para fazer o que a via gratuita deveria fazer.

    Falha que NAO e LoginRequired conta como INCONCLUSIVA e deixa passar: 429 ou
    queda de rede na propria checagem nao provam sessao morta, e tratar as duas
    como a mesma coisa e o erro que este projeto ja documentou em outros pontos
    (falha de consulta nao e ausencia de dado).
    """
    try:
        from instagrapi.exceptions import LoginRequired, ChallengeRequired
    except Exception:
        return True
    try:
        cl.account_info()
        return True
    except (LoginRequired, ChallengeRequired) as e:
        global _SESSAO_JA_RECUSADA
        _SESSAO_JA_RECUSADA = True
        # ASCII de proposito nesta linha: ela vem imediatamente ANTES do envio
        # do alerta, e um UnicodeEncodeError do console (cp1252 no Windows) aqui
        # mataria justamente o aviso que a funcao existe para dar.
        print(f"  [!] Sessao INVALIDA ({type(e).__name__}): o Instagram nao aceita "
              f"esta sessao. A coleta vai cair para a Apify (paga).")
        _avisar_sessao_invalida(type(e).__name__)
        return False
    except Exception as e:
        print(f"  ℹ Nao deu para validar a sessao ({type(e).__name__}) — seguindo")
        return True


def _avisar_sessao_invalida(detalhe: str) -> None:
    """Alerta de suporte, uma vez por dia. A condicao dura ate alguem gerar uma
    sessao nova, entao repetir a cada run viraria ruido — mesma janela do aviso
    de credito da Apify."""
    try:
        import alerta_suporte
        alerta_suporte.disparar(
            "instagram_sessao_invalida",
            f"Sessao do Instagram invalida ({detalhe}): o secret IG_SESSION_JSON "
            f"nao autentica mais. A coleta segue funcionando pela Apify, mas paga: "
            f"~US$ 17/mes contra um teto de US$ 29. Gere uma sessao nova e atualize "
            f"o secret.",
            janela_dedup_min=1440,
        )
    except Exception as e:
        print(f"  (alerta de sessao nao pode ser enviado: {e})")


def criar_cliente() -> "Client":
    """
    Cria e autentica o cliente Instagrapi.

    Ordem de preferência:
    1. IG_SESSION_JSON (env var — GitHub Actions, sem proxy)
    2. ig_session.json (arquivo local, sem proxy)
    3. Login completo com usuário/senha (com proxy)
    """
    if not INSTAGRAPI_DISPONIVEL:
        raise ImportError("instagrapi não instalado. Execute: pip install instagrapi")

    if _SESSAO_JA_RECUSADA:
        raise SessaoInvalida("sessao ja recusada neste run — nao insistindo")

    # 1. Sessão via variável de ambiente (GitHub Actions) — COM proxy.
    #
    # Este caminho desligava o proxy explicitamente, e isso custava caro: medido
    # em 01/09/26 no log do ÁGORA, a sessão carregava sem erro e os 14 perfis
    # voltavam 429 (Too Many Requests), porque as requisições saíam do IP do
    # runner do GitHub — datacenter que o Instagram estrangula na primeira leva.
    # O ciclo se fechava sozinho: sessão válida -> proxy ignorado -> 429 em tudo
    # -> zero posts -> Apify assume -> run VERDE. Ninguém era avisado, e os três
    # atores pagos rodando 3x/dia davam ~US$ 17/mês contra um teto de US$ 29,
    # com o serviço de proxy contratado e parado.
    #
    # Quem decide se há proxy é `_novo_cliente`: `_NO_PROXY` já desliga sozinho
    # quando IG_PROXY não está configurado no Actions. O 407 histórico que
    # motivou o `usar_proxy=False` era do HTTPS_PROXY global do workflow, não
    # deste proxy — está registrado no comentário do `_NO_PROXY` acima.
    if IG_SESSION_JSON:
        # Duas falhas DIFERENTES, e por isso dois blocos: nao conseguir LER a
        # sessao (JSON quebrado) permite tentar o arquivo/login; a sessao lida e
        # RECUSADA pelo Instagram nao permite, porque insistir com login a cada
        # run e o caminho mais rapido para a conta ser endurecida. A primeira
        # versao deste detector punha o `raise` dentro do try abaixo, o proprio
        # `except Exception` o engolia e o login acontecia assim mesmo — medido
        # no run 33470485272, que terminou em PleaseWaitFewMinutes.
        cl = None
        try:
            cl = _novo_cliente(usar_proxy=True)
            cl.set_settings(json.loads(IG_SESSION_JSON))
        except Exception as e:
            print(f"  ⚠ IG_SESSION_JSON ilegível ({e}) — tentando arquivo...")
            cl = None
        if cl is not None:
            if _sessao_viva(cl):
                print("  ✓ Sessão válida via IG_SESSION_JSON")
                return cl
            raise SessaoInvalida(
                "IG_SESSION_JSON nao autentica. Renove o secret; ate la a coleta "
                "sai pela Apify.")

    # 2. Sessão via arquivo local — COM proxy, pela mesma razão do caminho 1.
    session_path = Path(IG_SESSION_FILE)
    if session_path.exists():
        cl = None
        try:
            cl = _novo_cliente(usar_proxy=True)
            cl.load_settings(session_path)
        except Exception as e:
            print(f"  ⚠ Erro ao ler {IG_SESSION_FILE} ({e}) — fazendo novo login...")
            session_path.unlink(missing_ok=True)
            cl = None
        if cl is not None:
            if _sessao_viva(cl):
                print(f"  ✓ Sessão válida de {IG_SESSION_FILE}")
                return cl
            # Arquivo local recusado: apaga (é lixo) e para, pela mesma razão.
            session_path.unlink(missing_ok=True)
            raise SessaoInvalida(
                f"{IG_SESSION_FILE} nao autentica. Gere uma sessao nova.")

    # 3. Login completo — com proxy
    if not IG_USERNAME or not IG_PASSWORD:
        raise EnvironmentError("IG_USERNAME e IG_PASSWORD devem estar definidos")
    cl = _novo_cliente(usar_proxy=True)
    cl.login(IG_USERNAME, IG_PASSWORD)
    cl.dump_settings(session_path)
    print(f"  ✓ Login realizado e sessão salva ({IG_USERNAME})")
    return cl


def _info_do_perfil(cl, username: str):
    """Resolve um perfil pela API AUTENTICADA primeiro (`i.instagram.com`),
    caindo para o caminho padrão só se ela falhar.

    Medido em 01/09/26, em dois runs seguidos do ÁGORA: `user_id_from_username`
    resolve pelo endpoint PÚBLICO (`www.instagram.com/api/v1/users/
    web_profile_info`) e os 14 perfis voltavam 429 — antes e DEPOIS de ligar o
    proxy, o que descartou o IP como causa. O endpoint público é estrangulado
    para qualquer chamador; a sessão que já está carregada não vale nada ali.
    A v1 usa a sessão de verdade, que é para isso que ela existe.

    O fallback fica porque um 429 no público é recuperável (a Apify assume),
    enquanto um erro não tratado derrubaria o módulo inteiro.
    """
    try:
        return cl.user_info_by_username_v1(username)
    except Exception as e:
        print(f"    v1 falhou para @{username} ({type(e).__name__}) — tentando o público")
        return cl.user_info_by_username(username)


# ── Coleta de posts ────────────────────────────────────────────────────────────

def coletar_posts(perfis: list[str], dias_atras: int = DIAS_ATRAS) -> list[dict]:
    """
    Coleta posts recentes dos perfis monitorados.

    Retorna lista de dicts no mesmo formato do Apify:
      url, ownerUsername, caption, timestamp, likesCount, commentsCount
    """
    if not INSTAGRAPI_DISPONIVEL:
        raise ImportError("instagrapi não instalado.")

    cl = criar_cliente()
    cutoff = datetime.now(timezone.utc) - timedelta(days=dias_atras)
    todos_posts = []

    for username in perfis:
        try:
            user_id = _info_do_perfil(cl, username).pk
            medias  = cl.user_medias(user_id, amount=POSTS_POR_PERFIL)

            perfil_posts = 0
            for media in medias:
                # Filtra por data
                taken_at = media.taken_at
                if taken_at.tzinfo is None:
                    taken_at = taken_at.replace(tzinfo=timezone.utc)
                if taken_at < cutoff:
                    continue

                # Constrói URL do post
                code = media.code or str(media.pk)
                url  = f"https://www.instagram.com/p/{code}/"

                # Normaliza para o formato Apify
                todos_posts.append({
                    "url":           url,
                    "ownerUsername": username,
                    "caption":       media.caption_text or "",
                    "timestamp":     taken_at.isoformat(),
                    "likesCount":    media.like_count or 0,
                    "commentsCount": media.comment_count or 0,
                    "_media_pk":     str(media.pk),  # usado internamente para buscar comentários
                })
                perfil_posts += 1

            print(f"  @{username}: {perfil_posts} posts nos últimos {dias_atras} dias")
            time.sleep(random.uniform(*SLEEP_ENTRE_PERFIS))

        except UserNotFound:
            print(f"  ⚠ @{username}: perfil não encontrado ou privado")
        except RateLimitError:
            print("  ⚠ Rate limit atingido — pausando 60s...")
            time.sleep(60)
        except Exception as e:
            print(f"  ⚠ Erro ao coletar @{username}: {e}")

    print(f"  Total: {len(todos_posts)} posts coletados de {len(perfis)} perfis.")
    return todos_posts


# ── Coleta de métricas de perfil (seguidores) ─────────────────────────────────

def _e_bloqueio_sessao(erro: Exception) -> bool:
    """Reconhece o retry do urllib3 esgotado por 429 (ex.: 'Max retries
    exceeded ... too many 429 error responses'), diferente do RateLimitError
    tipado do instagrapi. Esse padrao sinaliza bloqueio da SESSAO inteira,
    nao um tropeco pontual de um unico perfil."""
    msg = str(erro).lower()
    return "429" in msg or "too many" in msg


def coletar_perfis(perfis: list[str]) -> list[dict]:
    """
    Lê os contadores públicos de cada perfil: seguidores, seguindo e nº de
    publicações. É a via GRATUITA do ranking de seguidores — o Apify
    (instagram-profile-scraper) só entra como fallback quando esta falha,
    porque créditos Apify são o recurso escasso do projeto.

    Retorna lista de dicts no formato normalizado pelo agora.py:
      username, followersCount, followsCount, postsCount

    Perfis que falharem individualmente são pulados (não derrubam os demais):
    um snapshot parcial ainda é útil, e o handle ausente simplesmente não
    ganha ponto novo na série do dia.
    """
    if not INSTAGRAPI_DISPONIVEL:
        raise ImportError("instagrapi não instalado.")

    cl = criar_cliente()
    coletados = []
    falhas_seguidas = 0

    for idx, username in enumerate(perfis):
        try:
            info = _info_do_perfil(cl, username)
            coletados.append({
                "username":       username,
                "followersCount": int(info.follower_count or 0),
                "followsCount":   int(info.following_count or 0),
                "postsCount":     int(info.media_count or 0),
            })
            print(f"  @{username}: {info.follower_count} seguidores")
            falhas_seguidas = 0
            time.sleep(random.uniform(*SLEEP_ENTRE_PERFIS))
        except UserNotFound:
            print(f"  ⚠ @{username}: perfil não encontrado ou privado")
            falhas_seguidas = 0
        except RateLimitError:
            print("  ⚠ Rate limit atingido — pausando 60s...")
            time.sleep(60)
            falhas_seguidas = 0
        except Exception as e:
            print(f"  ⚠ Erro ao ler @{username}: {e}")
            # Insistir perfil a perfil repete o mesmo estouro de retries em
            # cada um. Em 30/07 isso consumiu o resto do timeout-minutes do
            # step "Executar AGORA" e matou o run inteiro DEPOIS de posts,
            # comentarios e boletim ja terem sido gravados — o pipeline_health
            # (gravado so no fim do script) nunca chegava a atualizar, e o
            # dashboard acusava "radar parado" com dado novo la no banco.
            if _e_bloqueio_sessao(e):
                falhas_seguidas += 1
                if falhas_seguidas >= LIMIAR_BLOQUEIO_CONSECUTIVO:
                    restantes = len(perfis) - idx - 1
                    print(f"  ⚠ {falhas_seguidas} bloqueios seguidos — sessao "
                          f"limitada pelo Instagram, abortando ({restantes} "
                          "perfis restantes ficam sem ponto novo neste run)")
                    break
            else:
                falhas_seguidas = 0

    print(f"  Total: {len(coletados)}/{len(perfis)} perfis com métricas.")
    return coletados


# ── Coleta de comentários ──────────────────────────────────────────────────────

def coletar_comentarios(posts: list[dict]) -> list[dict]:
    """
    Coleta comentários dos posts fornecidos.

    Recebe a lista de posts (com campo _media_pk) e retorna lista de dicts
    no mesmo formato do Apify:
      postUrl, ownerUsername, text
    """
    if not posts:
        return []

    if not INSTAGRAPI_DISPONIVEL:
        raise ImportError("instagrapi não instalado.")

    cl = criar_cliente()
    todos_comentarios = []

    for post in posts:
        media_pk = post.get("_media_pk")
        post_url = post.get("url", "")
        if not media_pk:
            continue

        try:
            comentarios = cl.media_comments(media_pk, amount=COMENTARIOS_POR_POST)
            for c in comentarios:
                todos_comentarios.append({
                    "postUrl":       post_url,
                    "ownerUsername": c.user.username if c.user else "anon",
                    "text":          c.text or "",
                })

            print(f"  {post_url.split('/p/')[-1].rstrip('/')}: {len(comentarios)} comentários")
            time.sleep(random.uniform(*SLEEP_ENTRE_POSTS))

        except MediaNotFound:
            print(f"  ⚠ Post não encontrado: {post_url}")
        except RateLimitError:
            print("  ⚠ Rate limit — pausando 60s...")
            time.sleep(60)
        except Exception as e:
            print(f"  ⚠ Erro ao coletar comentários de {post_url}: {e}")

    print(f"  Total: {len(todos_comentarios)} comentários coletados.")
    return todos_comentarios


# ── Interface compatível com o pipeline (substitui Apify) ─────────────────────

def _limpar_texto_basico(texto: str) -> str:
    """
    Limpeza leve do texto de um comentário antes de entrar no prompt do Claude
    — remove URLs e caracteres de controle/ruído, colapsa espaços. Espelha
    limpar_texto() de radar_agente.py (duplicada aqui só para evitar import
    circular entre os dois módulos).

    Propositalmente NÃO filtra por palavra-chave: um filtro aqui reintroduziria
    o mesmo problema já corrigido do lado Apify (radar_agente.coletar_comentarios)
    — descartar comentários de crise genuínos que não citam explicitamente
    "prefeitura"/"gestão" (ex.: "que vergonha, incompetente!").
    """
    if not texto:
        return ""
    texto = re.sub(r"http\S+", "", texto)
    texto = re.sub(r"[^\w\s\.,!?;:\-áéíóúàâêôãõüçÁÉÍÓÚÀÂÊÔÃÕÜÇ@]", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def coletar_posts_e_comentarios(perfis: list[str], dias_atras: int = DIAS_ATRAS) -> tuple[list[dict], dict]:
    """
    Interface de alto nível que substitui as chamadas Apify no pipeline.

    Retorna:
      posts       — lista de posts (formato Apify)
      mapa_coment — dict {url: [comentários formatados como "username: texto"]}
    """
    print(f"  Coletando posts de {len(perfis)} perfis (últimos {dias_atras} dias)...")
    posts = coletar_posts(perfis, dias_atras)

    if not posts:
        return posts, {}

    urls_http = [p for p in posts if p.get("url", "").startswith("http")]
    print(f"\n  Coletando comentários de {len(urls_http)} posts...")
    comentarios_brutos = coletar_comentarios(urls_http)

    # Agrupa por URL no mesmo formato que o radar.py espera
    mapa: dict[str, list[str]] = {}
    for c in comentarios_brutos:
        url      = c.get("postUrl", "").rstrip("/")
        username = c.get("ownerUsername", "anon")
        texto    = _limpar_texto_basico(c.get("text", ""))
        if url and texto:
            mapa.setdefault(url, []).append(f"{username}: {texto}")

    return posts, mapa


# ── Verificação rápida de disponibilidade ─────────────────────────────────────

def disponivel() -> bool:
    """Retorna True se Instagrapi está instalado e credenciais configuradas."""
    return (
        INSTAGRAPI_DISPONIVEL and
        bool(IG_USERNAME) and
        bool(IG_PASSWORD)
    )
