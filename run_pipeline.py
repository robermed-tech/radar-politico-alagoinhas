#!/usr/bin/env python3
"""
Pipeline completo do Radar Político — Alagoinhas
  1. Dispara o scraper Apify (Instagram)
  2. Aguarda a coleta terminar
  3. Analisa os novos posts com Claude Haiku
  4. Salva resultados no Google Sheets

Uso:
  python run_pipeline.py            # coleta + análise (padrão)
  python run_pipeline.py --sem-apify  # só análise (usa dataset existente)
"""

import os
import sys
import time
import argparse
import requests
from dotenv import load_dotenv

load_dotenv(override=True)   # override=True: .env tem prioridade sobre vars de sistema (inclusive vazias)

APIFY_API_TOKEN = os.environ["APIFY_API_TOKEN"]
ACTOR_ID = "shu8hvrXbJbY3Eb9W"  # apify/instagram-scraper

# Importa PROFILES_META como fonte única de verdade para os perfis monitorados.
# Elimina a necessidade de manter duas listas sincronizadas manualmente.
from radar import PROFILES_META  # noqa: E402 (import após load_dotenv é intencional)

ACTOR_INPUT = {
    "addParentData": False,
    # directUrls gerado dinamicamente a partir de PROFILES_META
    "directUrls": [
        f"https://www.instagram.com/{username}/"
        for username in PROFILES_META
    ],
    "onlyPostsNewerThan": "2 days",   # buffer de 2 dias (duplicatas são ignoradas)
    "resultsLimit": 200,
    "resultsType": "posts",
    "searchLimit": 10,
    "searchType": "profile",
}


# ── APIFY ─────────────────────────────────────────────────────────────────────

def trigger_apify():
    """Dispara o actor Apify e retorna o run_id."""
    print("Iniciando coleta Apify...")
    headers = {"Authorization": f"Bearer {APIFY_API_TOKEN}"}
    r = requests.post(
        f"https://api.apify.com/v2/acts/{ACTOR_ID}/runs",
        json=ACTOR_INPUT,
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    run = r.json()["data"]
    print(f"  Run iniciado: {run['id']} | Status inicial: {run['status']}")
    return run["id"]


def wait_for_run(run_id, timeout=2700, interval=30):
    """
    Aguarda o run Apify terminar com polling.
    Timeout padrão: 45 minutos (o scraper de Instagram pode demorar).
    """
    print(f"Aguardando coleta (max {timeout // 60} min)...")
    elapsed = 0
    headers = {"Authorization": f"Bearer {APIFY_API_TOKEN}"}
    while elapsed < timeout:
        r = requests.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        run = r.json()["data"]
        status = run["status"]

        if status == "SUCCEEDED":
            dataset_id = run["defaultDatasetId"]
            item_count = run.get("stats", {}).get("itemCount", "?")
            print(f"  Coleta concluida! Dataset: {dataset_id} | Posts coletados: {item_count}")
            return dataset_id

        if status in ("FAILED", "ABORTED", "TIMED-OUT"):
            raise RuntimeError(f"Apify run terminou com erro: {status}")

        print(f"  {status}... {elapsed}s/{timeout}s")
        time.sleep(interval)
        elapsed += interval

    raise TimeoutError(f"Apify nao concluiu em {timeout // 60} minutos")


# ── PIPELINE ──────────────────────────────────────────────────────────────────

def main(sem_apify=False):
    print("=" * 60)
    print("RADAR POLITICO — PIPELINE AUTOMATICO")
    print("=" * 60)

    if sem_apify:
        dataset_id = os.environ.get("APIFY_DATASET_ID", "")
        if not dataset_id:
            print("ERRO: APIFY_DATASET_ID nao definido e --sem-apify ativado.")
            sys.exit(1)
        print(f"Usando dataset existente: {dataset_id}")
    else:
        run_id = trigger_apify()
        dataset_id = wait_for_run(run_id)
        # Injeta o novo dataset_id antes de importar radar.py
        os.environ["APIFY_DATASET_ID"] = dataset_id

    print()
    print("Iniciando analise de sentimento...")

    # radar já foi importado no topo (para PROFILES_META); apenas sincroniza vars
    import radar as _radar

    # Sincroniza variáveis do módulo com os valores corretos do .env
    _radar.APIFY_DATASET_ID   = dataset_id
    _radar.APIFY_API_TOKEN    = os.environ["APIFY_API_TOKEN"]
    _radar.ANTHROPIC_API_KEY  = os.environ["ANTHROPIC_API_KEY"]
    _radar.GOOGLE_SHEET_ID    = os.environ["GOOGLE_SHEET_ID"]

    _radar.main()

    print()
    print("Pipeline concluido com sucesso!")
    print("Acesse o dashboard e clique em Sincronizar para ver os novos dados.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pipeline Radar Politico Alagoinhas")
    parser.add_argument(
        "--sem-apify",
        action="store_true",
        help="Pula a coleta Apify e usa o dataset ja existente (APIFY_DATASET_ID no .env)",
    )
    args = parser.parse_args()
    main(sem_apify=args.sem_apify)
