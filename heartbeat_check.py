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
"""

import os
import sys
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT = os.environ.get("RADAR_TENANT", "alagoinhas")

EVOLUTION_URL = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_KEY = os.environ.get("EVOLUTION_API_KEY", "")
EVOLUTION_INSTANCE = os.environ.get("EVOLUTION_INSTANCE", "radar")
WHATSAPP_NUMBER = os.environ.get("WHATSAPP_NUMBER", "")

# Pipeline roda 3x/dia (a cada ~6-8h). Acima disso, ou faltou disparo do
# cron, ou o run travou/falhou sem chegar a gravar pipeline_health.
LIMIAR_HORAS = float(os.environ.get("HEARTBEAT_LIMIAR_HORAS", "9"))


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
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes — heartbeat nao pode checar nada. Pulando.")
        return 0

    url = (
        f"{SUPABASE_URL}/rest/v1/pipeline_health"
        f"?tenant=eq.{TENANT}&select=executado_em,status,posts_coletados&limit=1"
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

    if horas_desde <= LIMIAR_HORAS:
        print(f"Dentro do esperado (limiar {LIMIAR_HORAS}h). Nada a fazer.")
        return 0

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
    print("Alerta WhatsApp enviado." if enviado else "Alerta WhatsApp NAO enviado (ver log acima).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
