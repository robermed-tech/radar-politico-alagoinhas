"""
ALERTA DE SUPORTE — aviso imediato ao admin quando o pipeline ÁGORA para.

Por que existe como módulo separado (mesma razão do heartbeat_check.py): um
alerta que depende do próprio agora.py para funcionar não avisa de nada no dia
em que é o agora.py que quebra. Import isolado de propósito, sem puxar nada de
agora.py — só stdlib + requests.

Credenciais são lidas em tempo de CHAMADA (dentro de cada função), nunca como
constante de módulo: agora.py importa este arquivo ANTES de chamar
load_dotenv(), e constante de módulo capturaria string vazia pra sempre numa
execução local com .env (mesma armadilha já documentada para coletor_radio.py
e radio_analise.py — em CI não dá pra notar, porque os secrets já chegam via
env de verdade antes do processo iniciar).

Quem chama isto:
  1. agora.py, de dentro do próprio processo, no exato instante em que uma
     exceção não tratada sobe até o topo (motivo real, alerta mais rico).
  2. agora.py, no bloco de coleta vazia (motivo já conhecido: 0 posts).
  3. agora.yml, como BACKSTOP de linha de comando, para o caso que nenhum
     código Python consegue capturar — o job matado pelo timeout do GitHub
     Actions (mata o processo antes de qualquer except rodar).
  4. heartbeat_check.py, quando o cron do agora.yml simplesmente não disparou.

O destino (número, canais) é o que o ADMIN cadastrou em Configurações > Alerta
de Suporte (tenant_settings.notification_config) — não um secret fixo. Isso é
ADITIVO ao que já existia (grupo do WhatsApp via EVOLUTION_GROUP_ID no
heartbeat, mensagem ao "grupo" no agora.yml): nenhum dos dois é removido.
"""

import os
import sys
import time as _time
from datetime import datetime, timedelta, timezone

import requests

# Alertas do MESMO incidente batendo em detectores diferentes (ex.: o próprio
# agora.py capturou a exceção E o backstop do YAML rodou logo em seguida) nao
# viram dois avisos. Durante uma indisponibilidade prolongada, o heartbeat
# (a cada 15min) ainda reenvia um lembrete de tempos em tempos — só não em
# cada tick.
JANELA_DEDUP_MIN_PADRAO = 60

# Rótulo da issue usada como canal de reserva. Serve para achar o incidente já
# aberto e comentar nele, em vez de abrir uma issue nova a cada disparo.
ROTULO_ISSUE = "alerta-suporte"


def _supabase_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _supabase_key() -> str:
    return os.environ.get("SUPABASE_SERVICE_KEY", "")


def _tenant_padrao() -> str:
    return os.environ.get("RADAR_TENANT", "alagoinhas")


def _headers_supabase():
    key = _supabase_key()
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _carregar_config_suporte(tenant: str) -> dict:
    """Lê tenant_settings.notification_config; {} se indisponível ou tenant
    sem config ainda (não é erro — é o admin não ter configurado)."""
    url, key = _supabase_url(), _supabase_key()
    if not url or not key:
        return {}
    try:
        r = requests.get(
            f"{url}/rest/v1/tenant_settings",
            params={"tenant_id": f"eq.{tenant}", "select": "notification_config"},
            headers=_headers_supabase(), timeout=15,
        )
        if r.status_code != 200:
            return {}
        linhas = r.json()
        if not linhas:
            return {}
        return linhas[0].get("notification_config") or {}
    except Exception as e:
        print(f"  [alerta_suporte] Nao foi possivel ler tenant_settings ({e})")
        return {}


def _numero_normalizado(numero_bruto: str) -> str:
    """Só dígitos, com DDI 55 se ausente — mesma normalização usada no envio
    manual ao secretário (EnvioSecretario.tsx), pra o admin poder colar o
    número com ou sem +55/traços/espaços."""
    digitos = "".join(c for c in (numero_bruto or "") if c.isdigit())
    if not digitos:
        return ""
    return digitos if digitos.startswith("55") else "55" + digitos


def sugerir_correcao(motivo: str) -> str:
    """Casa o motivo com os incidentes já documentados no runbook do projeto
    (ver runbook_dashboard_congelado na memória) e devolve uma sugestão
    específica. Genérica só quando nada bate — melhor "confira os logs" do
    que inventar uma causa que os fatos disponíveis não sustentam."""
    m = (motivo or "").lower()

    def tem(*palavras):
        return any(p in m for p in palavras)

    if tem("apify") and tem("403", "401", "unauthorized", "invalid token", "token"):
        return ("Token da Apify parece inválido/expirado. Confira o secret "
                "APIFY_API_TOKEN no GitHub (Settings > Secrets) e o valor em "
                "apify.com > Settings > Integrations.")
    if tem("apify") and tem("credit", "limit", "monthly", "budget", "teto", "esgotad"):
        return ("Créditos da Apify podem estar esgotados no mês. Confira o uso em "
                "apify.com > Billing (ou a aba Créditos Apify na Configuração).")
    if tem("429", "too many", "rate limit", "checkpoint", "challenge_required"):
        return ("Sessão do Instagram provavelmente foi bloqueada/limitada. "
                "Aguarde alguns run's — se persistir, renove IG_SESSION_JSON.")
    if tem("instagram") and tem("login", "session", "senha", "password"):
        return ("Login/sessão do Instagram falhou. Gere uma sessão nova e "
                "atualize o secret IG_SESSION_JSON.")
    if tem("anthropic", "claude") and tem("529", "overloaded", "timeout", "timed out"):
        return ("API da Anthropic pode estar instável/sobrecarregada. Geralmente "
                "se resolve sozinho no próximo run; se persistir, confira "
                "status.anthropic.com.")
    if tem("anthropic", "claude") and tem("401", "403", "unauthorized", "invalid_api_key"):
        return "Chave da Anthropic parece inválida. Confira o secret ANTHROPIC_API_KEY."
    if tem("supabase", "postgrest") and tem("timeout", "connection", "econnrefused"):
        return ("Supabase pode estar fora do ar ou lento. Confira status.supabase.com "
                "e as credenciais SUPABASE_URL/SUPABASE_SERVICE_KEY.")
    if tem("timeout", "timed out"):
        return ("O passo travou e foi encerrado pelo limite de tempo do GitHub "
                "Actions. Confira o log do run: normalmente é uma chamada de rede "
                "(Instagram/Anthropic/Apify) que ficou tentando sem responder.")
    return ("Confira o log completo do run no GitHub Actions (aba Actions) para "
            "o erro exato — a causa não bateu com nenhum padrão conhecido.")


def _link_do_run() -> str:
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    if not run_id:
        return ""
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    return f"{server}/{repo}/actions/runs/{run_id}"


def montar_mensagem(origem: str, motivo: str, longa: bool = True) -> str:
    agora_str = datetime.now(timezone.utc).strftime("%d/%m %H:%M UTC")
    sugestao = sugerir_correcao(motivo)
    if longa:
        partes = [
            "🔴 *RADAR — pipeline parado*",
            f"Origem: {origem}",
            f"Motivo: {motivo.strip() or 'não identificado'}",
            f"Sugestão: {sugestao}",
        ]
        link = _link_do_run()
        if link:
            partes.append(f"Run: {link}")
        partes.append(f"({agora_str})")
        return "\n".join(partes)
    # SMS: uma mensagem curta custa menos e chega inteira num único segmento.
    texto = f"RADAR PARADO ({origem}): {motivo.strip() or 'erro nao identificado'}. {sugestao}"
    return texto[:300]


def _whatsapp_evolution(numero: str, texto: str, tentativas: int = 2) -> bool:
    """Provedor 1: Evolution API (auto-hospedada). O caminho original."""
    url_base = os.environ.get("EVOLUTION_API_URL", "")
    api_key = os.environ.get("EVOLUTION_API_KEY", "")
    instance = os.environ.get("EVOLUTION_INSTANCE", "radar")
    if not url_base or not api_key:
        return False
    if not url_base.startswith("https://"):
        print("  [alerta_suporte] EVOLUTION_API_URL deve usar HTTPS — envio bloqueado.")
        return False
    url = f"{url_base}/message/sendText/{instance}"
    headers = {"Content-Type": "application/json", "apikey": api_key}
    payload = {"number": numero, "text": texto}
    for t in range(tentativas):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=15)
            if r.status_code in (200, 201):
                return True
            # O corpo da resposta é o que distingue as causas: um 404 da
            # Evolution API tanto pode ser "instância inexistente ou
            # desconectada" quanto "este número não tem WhatsApp" (nos DDDs
            # > 30 o JID brasileiro perde o nono dígito, e é armadilha
            # conhecida). Logar só o status deixou um alerta que não entregava
            # nada sem diagnóstico possível — cinco testes seguidos em 31/07
            # renderam a mesma linha "HTTP 404" e nenhuma pista.
            print(f"  [alerta_suporte] WhatsApp/Evolution: HTTP {r.status_code} — "
                  f"{r.text[:300]}"
                  f"{' — retentando' if t == 0 else ' — desistindo'}")
        except Exception as e:
            print(f"  [alerta_suporte] WhatsApp/Evolution: erro {e}"
                  f"{' — retentando' if t == 0 else ' — desistindo'}")
        if t == 0:
            _time.sleep(3)
    return False


def _whatsapp_callmebot(numero: str, texto: str) -> bool:
    """Provedor 2: CallMeBot (gratuito, para alerta pessoal).

    É o caminho de menor atrito quando o destino é UM número fixo — o caso
    exato deste alerta: o dono do número manda uma mensagem única de opt-in ao
    bot ("I allow callmebot to send me messages"), recebe uma apikey pessoal, e
    a partir daí um GET simples entrega no WhatsApp dele. Sem servidor nosso,
    sem mensalidade, sem QR code para renovar (a fragilidade que derrubou a
    Evolution).

    A apikey é atrelada AO número que fez o opt-in — por isso o serviço só
    funciona para o alerta de suporte (destino fixo), nunca para mandar a
    terceiros como o "Alertar Secretário".
    """
    apikey = os.environ.get("CALLMEBOT_APIKEY", "")
    if not apikey:
        return False
    try:
        r = requests.get(
            "https://api.callmebot.com/whatsapp.php",
            params={"phone": "+" + numero, "apikey": apikey, "text": texto},
            timeout=30,
        )
        # A API poe o resultado no CORPO (HTML) e o status varia ate no erro
        # (apikey invalida veio com 203, medido em 31/07) — por isso o
        # veredito e pelo texto, aceitando qualquer 2xx.
        corpo = r.text.lower()
        if 200 <= r.status_code < 300 and ("queued" in corpo or "message sent" in corpo):
            return True
        # O veredito da API vem DEPOIS do eco da mensagem enviada — logar o
        # comeco do corpo mostrava so o nosso proprio texto de volta e
        # escondia o motivo real (aprendido no teste de 31/07).
        print(f"  [alerta_suporte] WhatsApp/CallMeBot: HTTP {r.status_code} — "
              f"fim da resposta: ...{r.text[-400:]}")
    except Exception as e:
        print(f"  [alerta_suporte] WhatsApp/CallMeBot: erro {e}")
    return False


def _whatsapp_twilio(numero: str, texto: str) -> bool:
    """Provedor 3: Twilio WhatsApp. Reusa as MESMAS credenciais do SMS
    (TWILIO_*), mais TWILIO_WHATSAPP_FROM (ex.: 'whatsapp:+14155238886', o
    numero do sandbox, ou um numero proprio aprovado). Se o admin criar a
    conta Twilio para o SMS, ganhar o WhatsApp e so um secret a mais."""
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    remetente = os.environ.get("TWILIO_WHATSAPP_FROM", "")
    if not sid or not token or not remetente:
        return False
    if not remetente.startswith("whatsapp:"):
        remetente = "whatsapp:" + remetente
    try:
        r = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, token),
            data={"To": f"whatsapp:+{numero}", "From": remetente, "Body": texto},
            timeout=15,
        )
        if r.status_code in (200, 201):
            return True
        print(f"  [alerta_suporte] WhatsApp/Twilio: HTTP {r.status_code} — {r.text[:300]}")
    except Exception as e:
        print(f"  [alerta_suporte] WhatsApp/Twilio: erro {e}")
    return False


# Ordem de tentativa: Evolution primeiro (canal original, sem limite de
# formato), depois CallMeBot (gratuito, feito para destino fixo), depois
# Twilio. O primeiro que entregar encerra — o objetivo é UMA mensagem no
# WhatsApp do admin, não três. O predicado de configuração é separado do
# envio para o log conseguir dizer "nenhum provedor configurado" (aviso de
# setup) sem confundir com "configurado e falhou" (incidente).
_PROVEDORES_WHATSAPP = (
    ("evolution",
     lambda: bool(os.environ.get("EVOLUTION_API_URL") and os.environ.get("EVOLUTION_API_KEY")),
     _whatsapp_evolution),
    ("callmebot",
     lambda: bool(os.environ.get("CALLMEBOT_APIKEY")),
     _whatsapp_callmebot),
    ("twilio",
     lambda: bool(os.environ.get("TWILIO_ACCOUNT_SID")
                  and os.environ.get("TWILIO_AUTH_TOKEN")
                  and os.environ.get("TWILIO_WHATSAPP_FROM")),
     _whatsapp_twilio),
)


def _enviar_whatsapp(numero: str, texto: str) -> bool:
    """Tenta os provedores em ordem e para no primeiro que entrega.

    Multi-provedor desde 31/07: o incidente da Evolution mostrou que amarrar o
    canal WhatsApp a um unico servico reintroduz o ponto unico de falha que o
    canal de reserva (issue) tinha acabado de tirar do sistema como um todo.
    Cada provedor se auto-desativa quando faltam as credenciais dele, entao o
    que o admin configurar passa a valer sem mudanca de codigo.
    """
    if not numero:
        print("  [alerta_suporte] WhatsApp: numero ausente — pulando.")
        return False
    configurados = [(nome, envia) for nome, tem_credencial, envia
                    in _PROVEDORES_WHATSAPP if tem_credencial()]
    if not configurados:
        print("  [alerta_suporte] WhatsApp: nenhum provedor configurado "
              "(Evolution, CallMeBot ou Twilio) — pulando.")
        return False
    for nome, envia in configurados:
        if envia(numero, texto):
            print(f"  [alerta_suporte] WhatsApp entregue via {nome}.")
            return True
    return False


def _enviar_sms(numero: str, texto: str) -> bool:
    """Twilio (conta a criar pelo admin — ver README/CLAUDE.md). Sem os 3
    secrets TWILIO_*, degrada em log e segue sem quebrar o resto do alerta,
    mesmo padrão do enviar_whatsapp quando faltam credenciais."""
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    remetente = os.environ.get("TWILIO_FROM_NUMBER", "")
    if not sid or not token or not remetente:
        print("  [alerta_suporte] SMS nao configurado (faltam TWILIO_ACCOUNT_SID/"
              "TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER) — pulando.")
        return False
    if not numero:
        return False
    destino = "+" + numero
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    try:
        r = requests.post(
            url,
            auth=(sid, token),
            data={"To": destino, "From": remetente, "Body": texto},
            timeout=15,
        )
        if r.status_code in (200, 201):
            return True
        print(f"  [alerta_suporte] SMS: HTTP {r.status_code} — {r.text[:200]}")
        return False
    except Exception as e:
        print(f"  [alerta_suporte] SMS: erro {e}")
        return False


def _enviar_github_issue(origem: str, motivo: str, sugestao: str) -> bool:
    """Canal de RESERVA: abre (ou comenta em) uma issue no próprio repositório.

    Existe por causa do incidente de 31/07: o servidor da Evolution API sumiu,
    e com ele o único caminho de aviso do sistema cujo trabalho é avisar. Um
    alerta de suporte com um canal só tem o mesmo ponto único de falha que ele
    deveria estar vigiando.

    Escolhido porque é o único canal que **não depende de nada a mais**: usa o
    GITHUB_TOKEN que o Actions já injeta em todo run, sem conta nova, sem
    secret novo, sem serviço para manter no ar. O GitHub notifica o dono do
    repo por e-mail e pelo app no celular. Não substitui o WhatsApp — que é
    mais imediato e é o que o admin pediu — mas garante que um incidente nunca
    fique sem destinatário.

    Reaproveita a issue aberta em vez de criar uma por disparo: numa
    indisponibilidade longa o heartbeat roda a cada 15 min, e isso viraria uma
    enxurrada de issues sobre o mesmo incidente. Cada novo disparo é um
    comentário, e o histórico do incidente fica num lugar só.
    """
    token = os.environ.get("GITHUB_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not token or not repo:
        # Fora do Actions (execução local) não há nem token nem repo: silêncio
        # aqui é o certo, senão todo teste local reclamaria de algo que não se
        # aplica.
        return False

    api = f"https://api.github.com/repos/{repo}"
    headers = {"Authorization": f"Bearer {token}",
               "Accept": "application/vnd.github+json"}
    corpo = (f"**Origem:** {origem}\n\n"
             f"**Motivo:** {motivo.strip() or 'não identificado'}\n\n"
             f"**Sugestão:** {sugestao}\n\n"
             f"_{datetime.now(timezone.utc).strftime('%d/%m %H:%M UTC')}_")
    link = _link_do_run()
    if link:
        corpo += f"\n\nRun: {link}"

    try:
        r = requests.get(f"{api}/issues", headers=headers,
                         params={"state": "open", "labels": ROTULO_ISSUE,
                                 "per_page": "1"}, timeout=15)
        aberta = r.json()[0] if (r.status_code == 200 and r.json()) else None
    except Exception as e:
        print(f"  [alerta_suporte] GitHub: nao foi possivel procurar issue aberta ({e})")
        aberta = None

    try:
        if aberta:
            r = requests.post(f"{api}/issues/{aberta['number']}/comments",
                              headers=headers, json={"body": corpo}, timeout=15)
            if r.status_code in (200, 201):
                print(f"  [alerta_suporte] GitHub: comentado na issue "
                      f"#{aberta['number']} (incidente ja aberto).")
                return True
        else:
            r = requests.post(f"{api}/issues", headers=headers, timeout=15,
                              json={"title": f"[alerta de suporte] {origem}",
                                    "body": corpo, "labels": [ROTULO_ISSUE]})
            if r.status_code in (200, 201):
                print(f"  [alerta_suporte] GitHub: issue #{r.json().get('number')} aberta.")
                return True
        print(f"  [alerta_suporte] GitHub: HTTP {r.status_code} — {r.text[:200]}")
    except Exception as e:
        print(f"  [alerta_suporte] GitHub: erro {e}")
    return False


def _ja_alertado_recentemente(tenant: str, janela_min: int) -> bool:
    url, key = _supabase_url(), _supabase_key()
    if not url or not key:
        return False
    try:
        limite = (datetime.now(timezone.utc) - timedelta(minutes=janela_min)).isoformat()
        r = requests.get(
            f"{url}/rest/v1/alerta_historico",
            params={
                "tenant_id": f"eq.{tenant}", "tipo": "eq.suporte",
                "criado_em": f"gte.{limite}", "select": "id", "limit": "1",
            },
            headers=_headers_supabase(), timeout=15,
        )
        return r.status_code == 200 and bool(r.json())
    except Exception:
        return False  # falha na checagem nao deve bloquear o alerta


def _registrar_alerta(tenant: str, mensagem: str, canais: str) -> None:
    url, key = _supabase_url(), _supabase_key()
    if not url or not key:
        return
    try:
        requests.post(
            f"{url}/rest/v1/alerta_historico",
            headers={**_headers_supabase(), "Prefer": "return=minimal"},
            json=[{
                "tenant_id": tenant, "tipo": "suporte", "canal": canais,
                "mensagem": mensagem, "criado_em": datetime.now(timezone.utc).isoformat(),
            }],
            timeout=15,
        )
    except Exception as e:
        print(f"  [alerta_suporte] Nao foi possivel registrar em alerta_historico ({e})")


def disparar(origem: str, motivo: str, tenant: str = None, forcar: bool = False,
             janela_dedup_min: int = JANELA_DEDUP_MIN_PADRAO) -> bool:
    """Ponto de entrada único. Retorna True se algum canal foi enviado com
    sucesso (ou se pulou por dedup — não é uma falha, é o comportamento
    esperado)."""
    tenant = tenant or _tenant_padrao()

    if not forcar and _ja_alertado_recentemente(tenant, janela_dedup_min):
        print(f"  [alerta_suporte] Ja alertado nos ultimos {janela_dedup_min}min — pulando (mesmo incidente).")
        return True

    cfg = _carregar_config_suporte(tenant)
    numero_bruto = (cfg.get("alerta_suporte_numero") or "").strip()
    usa_whats = bool(cfg.get("alerta_suporte_whatsapp", True))
    usa_sms   = bool(cfg.get("alerta_suporte_sms", False))
    numero = _numero_normalizado(numero_bruto)

    if not numero:
        print("  [alerta_suporte] Nenhum numero cadastrado em Configuracoes > "
              "Alerta de Suporte — nada a enviar.")
        return False
    if not usa_whats and not usa_sms:
        print("  [alerta_suporte] Numero cadastrado mas nenhum canal (WhatsApp/SMS) ativo — nada a enviar.")
        return False

    canais_ok = []
    if usa_whats:
        if _enviar_whatsapp(numero, montar_mensagem(origem, motivo, longa=True)):
            canais_ok.append("whatsapp")
    if usa_sms:
        if _enviar_sms(numero, montar_mensagem(origem, motivo, longa=False)):
            canais_ok.append("sms")

    # Reserva: só entra quando os canais que o admin escolheu falharam todos.
    # Enquanto o WhatsApp funciona, não polui o repositório com issue nenhuma —
    # e no dia em que ele cai, o incidente continua tendo destinatário.
    if not canais_ok:
        if _enviar_github_issue(origem, motivo, sugerir_correcao(motivo)):
            canais_ok.append("github_issue")

    if canais_ok:
        _registrar_alerta(tenant, f"[{origem}] {motivo}"[:2000], ",".join(canais_ok))
        print(f"  [alerta_suporte] Enviado via {', '.join(canais_ok)}.")
        return True

    # Quando o canal de aviso é o que está quebrado, ninguém fica sabendo pelo
    # próprio canal — foi o que aconteceu em 31/07: o servidor da Evolution
    # tinha sumido e o alerta de suporte falhava em silêncio, justamente o
    # sistema cujo trabalho é não deixar falha passar despercebida.
    #
    # `::error::` faz o GitHub destacar a linha na interface e incluí-la no
    # e-mail de falha do workflow, que ele já manda ao dono do repo sem
    # nenhuma infraestrutura nossa. É o único caminho de aviso que não depende
    # de nada que possamos ter deixado cair.
    print("  [alerta_suporte] Nenhum canal configurado enviou com sucesso "
          "(ver mensagens acima).")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::error::Canal de alerta FORA DO AR — o aviso '{origem}' nao "
              "foi entregue a ninguem. Rode o workflow Heartbeat com a opcao "
              "'diagnostico' para ver em qual camada esta a falha (servidor, "
              "instancia ou numero).")
    return False


def diagnosticar(tenant: str = None) -> int:
    """Separa as camadas que um HTTP 404 sozinho confunde.

    "Não recebi o alerta" tem causas muito diferentes, e o envio devolve o
    mesmo 404 para várias delas: o servidor da Evolution não existe mais, a
    instância foi removida, a instância existe mas está desconectada do
    WhatsApp, ou o número cadastrado simplesmente não tem WhatsApp. Chutar
    entre essas hipóteses custou uma tarde em 31/07 — daí testar uma por vez,
    de fora para dentro, parando na primeira que falha.

    Nunca imprime a URL nem a apikey: o veredito não precisa delas, e o log do
    Actions é público neste repo.

    Retorna 0 se o caminho inteiro está de pé.
    """
    def veredito(texto: str, ok: bool = False) -> int:
        """Imprime o veredito e, no Actions, marca a linha como erro.

        `::error::` sobe o texto para a interface do run e para o e-mail de
        falha que o GitHub já manda ao dono do repo — o único aviso que não
        depende do canal que pode estar quebrado. Sem isso, o diagnóstico de um
        canal caído só existiria dentro do log, que ninguém abre justamente
        quando não recebeu notificação nenhuma.
        """
        print(f"  VEREDITO: {texto}")
        if not ok and os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::error::Alerta de suporte — {texto}")
        return 0 if ok else 1

    url_base = os.environ.get("EVOLUTION_API_URL", "").rstrip("/")
    api_key = os.environ.get("EVOLUTION_API_KEY", "")
    instance = os.environ.get("EVOLUTION_INSTANCE", "radar")
    cfg = _carregar_config_suporte(tenant or _tenant_padrao())
    numero = _numero_normalizado((cfg.get("alerta_suporte_numero") or "").strip())

    provedores = [nome for nome, tem_credencial, _ in _PROVEDORES_WHATSAPP
                  if tem_credencial()]
    print("=== Diagnostico do alerta de suporte ===")
    print(f"  [1/4] Configuracao: provedores WhatsApp com credencial: "
          f"{', '.join(provedores) if provedores else 'NENHUM'} | "
          f"numero cadastrado {'ok (' + str(len(numero)) + ' digitos)' if numero else 'AUSENTE'}")
    if not numero:
        return veredito("NUMERO — nenhum numero em Configuracoes > Alerta de Suporte.")
    if not provedores:
        return veredito("SISTEMA — nenhum provedor de WhatsApp tem credencial "
                        "nos secrets (Evolution, CallMeBot ou Twilio).")
    if "evolution" not in provedores:
        # As camadas 2-4 são específicas da Evolution (host, instância,
        # número via API dela). CallMeBot/Twilio não expõem checagem sem
        # enviar de verdade — para esses, o teste honesto é o botão
        # "Enviar teste" da UI.
        return veredito(
            f"configuracao presente ({', '.join(provedores)}). Estes provedores "
            "nao tem checagem sem envio — use o botao 'Enviar teste' da UI "
            "para validar a entrega.", ok=True)

    # 2. O host existe? "Application not found" aqui é a plataforma de
    #    hospedagem respondendo, não a Evolution — ou seja, o servidor sumiu.
    try:
        r = requests.get(url_base, timeout=15)
        corpo = r.text[:200]
        print(f"  [2/4] Host responde: HTTP {r.status_code} — {corpo}")
        host_sumiu = ("Application not found" in corpo
                      or (r.status_code == 404 and "not found" in corpo.lower()))
        if host_sumiu:
            return veredito(
                "SISTEMA — o servidor da Evolution API nao existe mais neste "
                "endereco. Reprovisione a instancia ou atualize o secret "
                "EVOLUTION_API_URL. O numero cadastrado nao tem nenhuma "
                "relacao com esta falha.")
    except Exception as e:
        print(f"  [2/4] Host inacessivel: {e}")
        return veredito("SISTEMA — o endereco da Evolution API nao responde.")

    # 3. A instância existe e está conectada ao WhatsApp?
    try:
        r = requests.get(f"{url_base}/instance/connectionState/{instance}",
                         headers={"apikey": api_key}, timeout=15)
        print(f"  [3/4] Instancia '{instance}': HTTP {r.status_code} — {r.text[:200]}")
        if r.status_code == 404:
            return veredito(f"SISTEMA — a instancia '{instance}' nao existe neste "
                            "servidor (confira o secret EVOLUTION_INSTANCE).")
        estado = ""
        try:
            d = r.json()
            estado = str((d.get("instance") or d).get("state") or "")
        except Exception:
            pass
        if estado and estado != "open":
            return veredito(f"SISTEMA — a instancia existe mas esta '{estado}', nao "
                            "conectada ao WhatsApp. Reconecte lendo o QR code.")
    except Exception as e:
        print(f"  [3/4] Erro ao consultar a instancia: {e}")
        return 1

    # 4. Só agora faz sentido perguntar do número: as camadas de baixo estão de pé.
    try:
        r = requests.post(f"{url_base}/chat/whatsappNumbers/{instance}",
                          headers={"apikey": api_key, "Content-Type": "application/json"},
                          json={"numbers": [numero]}, timeout=15)
        print(f"  [4/4] Numero cadastrado: HTTP {r.status_code} — {r.text[:300]}")
        existe = None
        try:
            itens = r.json()
            if isinstance(itens, list) and itens:
                existe = bool(itens[0].get("exists"))
        except Exception:
            pass
        if existe is False:
            return veredito(
                "NUMERO — o servidor e a instancia estao de pe, mas este numero "
                "nao tem WhatsApp. Confira o DDD e o nono digito em "
                "Configuracoes > Alerta de Suporte.")
    except Exception as e:
        print(f"  [4/4] Erro ao checar o numero: {e}")
        return 1

    return veredito("o caminho inteiro esta de pe — servidor, instancia e numero.",
                    ok=True)


if __name__ == "__main__":
    # python-dotenv é conveniência de máquina local: serve para ler o .env
    # quando se roda na mão. Em CI as variáveis já chegam como ambiente de
    # verdade, e o heartbeat.yml instala só `requests` — importar sem proteção
    # fazia o script morrer no import antes de diagnosticar coisa alguma,
    # justamente no lugar em que ele existe para rodar. Mesmo padrão do
    # coletor_radio.py.
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    def _arg_valor(nome: str, default: str = "") -> str:
        for i, a in enumerate(sys.argv):
            if a == nome and i + 1 < len(sys.argv):
                return sys.argv[i + 1]
            if a.startswith(nome + "="):
                return a.split("=", 1)[1]
        return default

    if "--diagnostico" in sys.argv:
        sys.exit(diagnosticar())

    _origem = _arg_valor("--origem", "manual")
    _motivo = _arg_valor("--motivo", "sem detalhe (chamada manual/backstop)")
    _forcar = "--teste" in sys.argv or "--forcar" in sys.argv
    if "--teste" in sys.argv:
        _origem = "teste_manual"
        _motivo = "Este e um alerta de TESTE disparado pelo admin para conferir o numero/canal cadastrados."

    ok = disparar(_origem, _motivo, forcar=_forcar)
    sys.exit(0 if ok else 1)
