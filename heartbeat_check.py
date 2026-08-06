"""
HEARTBEAT — vigia externo do pipeline ÁGORA.

Por que existe: agora.py agora grava sua própria saúde em `pipeline_health`
a cada run (inclusive em coleta vazia). Mas isso só ajuda se o agora.py
CHEGAR a rodar. Se o cron do GitHub Actions parar de disparar — workflow
desativado por 60 dias de inatividade do repo, erro de YAML, remoção
acidental do secret — nada dentro do agora.py roda para avisar disso.

Este script roda como um workflow SEPARADO (heartbeat.yml), com seu próprio
cron, e faz a pergunta de fora: "quando foi a última vez que o pipeline
principal escreveu algo?" Se faz tempo demais, avisa por WhatsApp.

Não depende de agora.py (import isolado de propósito — um heartbeat que
quebra junto com o que ele deveria vigiar não serve para nada).

Desde 31/07/26 soma o envio ao número que o ADMIN cadastrou em Configurações >
Alerta de Suporte (alerta_suporte.py — WhatsApp e/ou SMS, dedup próprio via
alerta_historico). É ADITIVO: o alerta pro grupo fixo (WHATSAPP_NUMBER, o
EVOLUTION_GROUP_ID de sempre) continua exatamente como era.
"""

import os
import sys
from datetime import datetime, timezone

import requests

try:
    import alerta_suporte as _alerta
    _ALERTA_SUPORTE_OK = True
except Exception:
    _ALERTA_SUPORTE_OK = False

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT = os.environ.get("RADAR_TENANT", "alagoinhas")

EVOLUTION_URL = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_KEY = os.environ.get("EVOLUTION_API_KEY", "")
EVOLUTION_INSTANCE = os.environ.get("EVOLUTION_INSTANCE", "radar")
WHATSAPP_NUMBER = os.environ.get("WHATSAPP_NUMBER", "")

# Pipeline roda 3x/dia: 08h, 14h, 19h BRT (agora.yml). O maior intervalo é o
# noturno, 19h -> 08h do dia seguinte = 13h, por desenho (nao roda de
# madrugada). Limiar precisa ficar acima disso + folga para atraso normal do
# runner do GitHub, senao dispara falso alarme toda madrugada.
LIMIAR_HORAS = float(os.environ.get("HEARTBEAT_LIMIAR_HORAS", "15"))

# Coleta vazia por CRÉDITO ESGOTADO da Apify é uma condição que dura dias e
# cuja correção é do dono da conta (recarregar em apify.com/billing), não do
# sistema. Com a dedup padrão de 60min, o heartbeat (que roda a cada 15min)
# mandaria um alerta por hora, indefinidamente — e, com o WhatsApp fora do ar,
# uma issue por hora no repositório. Um lembrete por dia basta: a informação
# não muda, e alerta que repete demais é alerta que ninguém lê.
# (Situação real de 06/08: Apify em 101,1%, travada nesse valor desde 27/07.)
DEDUP_CREDITO_MIN = int(os.environ.get("HEARTBEAT_DEDUP_CREDITO_MIN", "1440"))


def _uso_apify() -> dict:
    """Último uso registrado da Apify (service_status), gravado por
    agora.py::verificar_creditos_apify a cada run. {} se indisponível — a
    ausência do dado nunca pode impedir o alerta genérico de coleta vazia."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/service_status",
            params={"tenant": f"eq.{TENANT}", "servico": "eq.apify", "limit": "1"},
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=20,
        )
        if r.status_code == 200 and r.json():
            return r.json()[0]
    except Exception as e:
        print(f"  service_status(apify): erro ao consultar ({e}) — seguindo sem esse dado.")
    return {}


def enviar_whatsapp(mensagem: str) -> bool:
    if not EVOLUTION_URL or not EVOLUTION_KEY or not WHATSAPP_NUMBER:
        print("  WhatsApp nao configurado — alerta so no log deste job.")
        return False
    if not EVOLUTION_URL.startswith("https://"):
        print("  EVOLUTION_API_URL deve usar HTTPS — envio bloqueado.")
        return False
    url = f"{EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}"
    headers = {"Content-Type": "application/json", "apikey": EVOLUTION_KEY}
    try:
        r = requests.post(url, headers=headers, json={"number": WHATSAPP_NUMBER, "text": mensagem}, timeout=15)
        return r.status_code in (200, 201)
    except Exception as e:
        print(f"  WhatsApp: erro ao enviar ({e})")
        return False


def main() -> int:
    # Disparo manual do botao "Enviar teste" (Configuracoes > Alerta de
    # Suporte -> Edge Function -> workflow_dispatch com teste_alerta=true).
    # Ignora toda a logica de atraso: o admin quer saber SE o numero/canal
    # cadastrados funcionam, nao se o pipeline esta saudavel agora.
    if os.environ.get("TESTE_ALERTA", "").lower() == "true":
        print("TESTE_ALERTA=true — disparando alerta de teste (ignora dedup e limiar).")
        if not _ALERTA_SUPORTE_OK:
            print("alerta_suporte.py indisponivel (falha de import) — nao ha o que testar.")
            return 1
        ok = _alerta.disparar(
            "teste_manual",
            "Este e um alerta de TESTE disparado pelo admin para conferir o numero/canal cadastrados.",
            forcar=True,
        )
        return 0 if ok else 1

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes — heartbeat nao pode checar nada. Pulando.")
        return 0

    url = (
        f"{SUPABASE_URL}/rest/v1/pipeline_health"
        f"?tenant=eq.{TENANT}&select=executado_em,status,posts_coletados"
        f"&order=executado_em.desc&limit=2"
    )
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        r = requests.get(url, headers=headers, timeout=20)
    except Exception as e:
        print(f"Nao foi possivel consultar o Supabase ({e}) — sem dado suficiente para alertar.")
        return 0

    if r.status_code != 200:
        print(f"Supabase respondeu HTTP {r.status_code} — sem dado suficiente para alertar.")
        return 0

    linhas = r.json()
    if not linhas:
        # Tabela existe mas nunca recebeu nenhum run — cenario de setup novo,
        # nao de pipeline que "parou". Nao alerta para nao confundir onboarding.
        print(f"pipeline_health vazio para tenant={TENANT} (nenhum run registrado ainda).")
        return 0

    ultimo = linhas[0]
    executado_em_str = ultimo.get("executado_em")
    if not executado_em_str:
        print("Ultima linha de pipeline_health sem 'executado_em' — nao da para medir atraso.")
        return 0

    executado_em = datetime.fromisoformat(executado_em_str.replace("Z", "+00:00"))
    if executado_em.tzinfo is None:
        executado_em = executado_em.replace(tzinfo=timezone.utc)
    horas_desde = (datetime.now(timezone.utc) - executado_em).total_seconds() / 3600

    print(f"Ultima execucao do ÁGORA: {executado_em.isoformat()} ({horas_desde:.1f}h atras), status={ultimo.get('status')}")

    if horas_desde > LIMIAR_HORAS:
        mensagem = (
            "🔴 *RADAR — pipeline parado*\n"
            f"O ÁGORA não roda há {horas_desde:.0f}h (última execução registrada: "
            f"{executado_em.strftime('%d/%m %H:%M UTC')}).\n"
            "O cron pode ter parado de disparar (GitHub desativa workflows agendados "
            "após 60 dias sem atividade no repo) ou o job está travando antes de "
            "gravar pipeline_health.\n"
            "Verifique a aba Actions do repositório."
        )
        print(mensagem)
        enviado = enviar_whatsapp(mensagem)
        print("Alerta WhatsApp (grupo) enviado." if enviado else "Alerta WhatsApp (grupo) NAO enviado (ver log acima).")
        if _ALERTA_SUPORTE_OK:
            _alerta.disparar("heartbeat", f"O ÁGORA não roda há {horas_desde:.0f}h — o cron pode ter parado de disparar.")
        return 0

    print(f"Dentro do esperado (limiar {LIMIAR_HORAS}h).")

    # Cron disparando normalmente, mas coletando nada: sintoma diferente do
    # "parou de rodar" acima, tao "parado" quanto do ponto de vista do
    # produto (dashboard sem dado novo). So soa depois de 2 runs seguidos com
    # coleta vazia — 1 run zerado pode ser dia sem post publicado de verdade;
    # 2 seguidos ja indica bloqueio/token/credito.
    if len(linhas) >= 2 and all(
        (l.get("status") == "coleta_vazia" or int(l.get("posts_coletados") or 0) == 0)
        for l in linhas[:2]
    ):
        print("Ultimos 2 runs com coleta vazia — pode ser bloqueio/token/credito, nao so dia parado.")
        if _ALERTA_SUPORTE_OK:
            # Quando a causa é conhecida (teto da Apify), o alerta NOMEIA o
            # serviço e o valor, e espaça para 1x/dia: a condição dura dias e
            # quem resolve é o dono da conta. Sem esse dado, segue o texto
            # genérico e a dedup padrão de 60min.
            apify = _uso_apify()
            pct = float(apify.get("uso_pct") or 0)
            teto = float(apify.get("teto_usd") or 0)
            if pct >= 100 and teto > 0:
                uso = float(apify.get("uso_usd") or 0)
                _alerta.disparar(
                    "heartbeat_apify_sem_credito",
                    f"Coleta parada: os creditos da Apify acabaram "
                    f"(US$ {uso:.2f} de US$ {teto:.2f}, {pct:.0f}% do teto mensal). "
                    f"O ÁGORA continua rodando, mas volta com 0 posts ate a recarga "
                    f"em apify.com/billing.",
                    janela_dedup_min=DEDUP_CREDITO_MIN,
                )
            else:
                _alerta.disparar(
                    "heartbeat_coleta_vazia",
                    "As duas ultimas execucoes do ÁGORA coletaram 0 posts do Instagram.",
                )
    else:
        print("Nada a fazer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
