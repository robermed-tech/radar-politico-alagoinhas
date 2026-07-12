"""
Checagem INDEPENDENTE de uso de creditos Apify — atualiza service_status
sem depender do agora.py rodar por inteiro (3x/dia).

Por que existe: o widget de creditos no Admin (radar-app) le da tabela
service_status, que so era escrita dentro de verificar_creditos_apify(),
chamada uma vez por execucao do ÁGORA. Entre execucoes o numero ficava
horas desatualizado (o console da Apify mostra o uso em tempo real; o
dashboard nao). Este script faz so a chamada de status (GET /users/me,
nao consome credito de actor) e roda no seu proprio cron, bem mais
frequente que o pipeline completo.

Nao importa agora.py de proposito — mesmo motivo do heartbeat_check.py:
um checador que depende do modulo que ele deveria vigiar/complementar
fica fragil junto com ele.
"""

import os
import sys
from datetime import datetime, timezone

import requests

APIFY_TOKEN = os.environ.get("APIFY_API_TOKEN", "")
APIFY_BASE = "https://api.apify.com/v2"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
TENANT = os.environ.get("RADAR_TENANT", "alagoinhas")


def main() -> int:
    if not APIFY_TOKEN:
        print("APIFY_API_TOKEN ausente — nada a checar.")
        return 0
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes — nao ha onde gravar o status.")
        return 0

    try:
        # /users/me nao retorna mais 'monthlyUsage' (API mudou) — o campo
        # sempre vem ausente e um .get(...,{}) mascarava isso caindo
        # silenciosamente em $0,00/0%, sem erro nenhum. /users/me/limits
        # e o endpoint correto pro uso atual (confirmado contra o console
        # real da Apify em 11/07/26).
        r = requests.get(f"{APIFY_BASE}/users/me/limits", params={"token": APIFY_TOKEN}, timeout=10)
    except Exception as e:
        print(f"Erro ao consultar Apify: {e}")
        return 0

    if r.status_code != 200:
        print(f"Apify respondeu HTTP {r.status_code} — nao atualizando (token invalido/revogado?).")
        return 0

    data = r.json().get("data", {})
    uso = data.get("current", {}).get("monthlyUsageUsd", 0) or 0
    teto = data.get("limits", {}).get("maxMonthlyUsageUsd", 0) or 0

    if not teto:
        print(f"Uso ${uso:.2f} (teto nao identificado no plano) — nao atualizando (sem teto nao da pra calcular %).")
        return 0

    pct = (uso / teto) * 100
    print(f"Apify credits: ${uso:.2f} / ${teto:.2f} ({pct:.1f}%)")

    url = f"{SUPABASE_URL}/rest/v1/service_status?on_conflict=tenant,servico"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    payload = [{
        "tenant": TENANT, "servico": "apify",
        "uso_pct": round(pct, 1), "uso_usd": round(uso, 4),
        "teto_usd": round(teto, 4),
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
    }]
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=15)
        if resp.status_code in (200, 201, 204):
            print("service_status atualizado.")
        else:
            print(f"Supabase respondeu HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"Erro ao gravar no Supabase: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
