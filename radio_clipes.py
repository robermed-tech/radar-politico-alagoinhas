"""Recorte do áudio da citação — Rádio Escuta.

O card da pauta mostra uma CITAÇÃO que veio de transcrição automática, e o
Whisper alucina sobre música (saiu "Suzy Allison Dance The Two Step" de uma letra
em inglês). O instante `ts_inicio` sempre esteve na tela para permitir
conferência; este módulo põe o trecho de áudio ao lado da frase, para conferir
virar um clique em vez de uma expedição.

── Por que recortar, e não apontar para a Apify ──────────────────────────────
Três medições feitas em 30/07 fecham a questão:

1. O key-value store guarda o bloco INTEIRO: 28,6 MB para 30 min de captação.
2. Ele **não aceita Range** — pedir 100 KB devolveu os 28,6 MB. Um proxy
   baixaria o arquivo completo a cada seek do player.
3. A retenção de dados do plano é de **3 dias**, e as pautas vivem 90. Um player
   apontando para lá estaria quebrado na maioria dos cards.

O recorte de ~24 s pesa ~0,4 MB, vive no nosso storage e dura o que a pauta
durar.

── Privacidade ───────────────────────────────────────────────────────────────
O clipe pode conter a voz de um ouvinte que ligou para a rádio e se identificou
no ar — alguém que nunca escolheu falar com este sistema. Por isso o bucket é
PRIVADO, o acesso é por URL assinada de vida curta, e o clipe entra no mesmo
expurgo de 90 dias da transcrição (`expurgar_pii_radio`): apagar o texto e
deixar a voz seria pior que não ter apagado nada.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import requests

BUCKET = "radio-clipes"
# Segundos antes e depois do instante da citação. A citação começa em ts_inicio,
# mas o começo da frase costuma estar um pouco antes do ponto que o segmento
# marca — e ouvir a frase sem o que veio logo antes atrapalha justamente a
# conferência de contexto que motiva o recurso.
MARGEM_ANTES = 4
MARGEM_DEPOIS = 20
DURACAO_MAX_CLIPE = 45


def _log(msg: str) -> None:
    print(f"    {msg}", flush=True)


# As credenciais são lidas em tempo de CHAMADA, nunca no import: o agora.py
# chama load_dotenv() DEPOIS dos imports, e constante de módulo ficaria vazia
# quando as credenciais vêm do .env. Já custou um diagnóstico falso uma vez.
def _sb_url() -> str:
    return (os.getenv("SUPABASE_URL") or "").rstrip("/")


def _sb_key() -> str:
    return os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""


def _apify_token() -> str:
    return os.getenv("APIFY_API_TOKEN") or ""


def ffmpeg_disponivel() -> bool:
    return shutil.which("ffmpeg") is not None


def baixar_audio_do_bloco(run_id: str, store_key: str, destino: Path) -> bool:
    """Baixa o áudio inteiro do bloco do key-value store da Apify.

    É feito UMA vez por bloco e reaproveitado por todas as pautas dele — baixar
    28 MB por citação seria pagar três vezes pelo mesmo arquivo.
    """
    token = _apify_token()
    if not (token and run_id and store_key):
        return False
    try:
        r = requests.get(f"https://api.apify.com/v2/actor-runs/{run_id}",
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)
        if r.status_code != 200:
            _log(f"run {run_id} nao encontrado na Apify ({r.status_code}) — audio provavelmente expirou")
            return False
        kv = r.json()["data"].get("defaultKeyValueStoreId")
        if not kv:
            return False
        url = f"https://api.apify.com/v2/key-value-stores/{kv}/records/{store_key}"
        with requests.get(url, headers={"Authorization": f"Bearer {token}"},
                          stream=True, timeout=300) as resp:
            if resp.status_code != 200:
                _log(f"audio indisponivel na Apify ({resp.status_code}) — retencao do plano e de 3 dias")
                return False
            with open(destino, "wb") as f:
                for pedaco in resp.iter_content(chunk_size=1 << 20):
                    f.write(pedaco)
        return destino.exists() and destino.stat().st_size > 0
    except Exception as e:  # rede, timeout, JSON inesperado
        _log(f"falha ao baixar o audio do bloco: {e}")
        return False


def recortar(origem: Path, ts_inicio: float, destino: Path) -> bool:
    """Recorta o trecho com ffmpeg, SEM reencodar (`-c copy`).

    Sem reencode o corte é instantâneo e não perde qualidade; em compensação o
    ffmpeg alinha o início no quadro MP3 mais próximo, o que desloca o começo em
    alguns centésimos. Para conferir uma frase falada isso é irrelevante, e a
    alternativa (reencodar) custaria segundos de CPU por clipe sem ganho audível.
    """
    inicio = max(0.0, float(ts_inicio) - MARGEM_ANTES)
    dur = min(DURACAO_MAX_CLIPE, MARGEM_ANTES + MARGEM_DEPOIS)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{inicio:.2f}", "-t", f"{dur:.2f}", "-i", str(origem),
           "-c", "copy", str(destino)]
    try:
        subprocess.run(cmd, check=True, timeout=120)
        return destino.exists() and destino.stat().st_size > 0
    except Exception as e:
        _log(f"ffmpeg falhou no recorte: {e}")
        return False


def subir(caminho: Path, destino_no_bucket: str) -> bool:
    """Sobe o clipe para o bucket privado. Idempotente (upsert)."""
    url, key = _sb_url(), _sb_key()
    if not (url and key):
        _log("SUPABASE_URL/SERVICE_KEY ausentes — clipe nao enviado")
        return False
    try:
        with open(caminho, "rb") as f:
            r = requests.post(
                f"{url}/storage/v1/object/{BUCKET}/{destino_no_bucket}",
                headers={
                    "Authorization": f"Bearer {key}",
                    "apikey": key,
                    "Content-Type": "audio/mpeg",
                    "x-upsert": "true",
                },
                data=f, timeout=120,
            )
        if r.status_code not in (200, 201):
            _log(f"upload do clipe falhou ({r.status_code}): {r.text[:160]}")
            return False
        return True
    except Exception as e:
        _log(f"upload do clipe falhou: {e}")
        return False


def apagar(caminhos: list[str]) -> int:
    """Apaga clipes do bucket (usado pelo expurgo de 90 dias)."""
    url, key = _sb_url(), _sb_key()
    if not (url and key and caminhos):
        return 0
    try:
        r = requests.delete(
            f"{url}/storage/v1/object/{BUCKET}",
            headers={"Authorization": f"Bearer {key}", "apikey": key,
                     "Content-Type": "application/json"},
            json={"prefixes": caminhos}, timeout=60,
        )
        return len(caminhos) if r.status_code == 200 else 0
    except Exception as e:
        _log(f"falha ao apagar clipes: {e}")
        return 0


def gerar_para_bloco(bloco: dict, pautas: list[dict]) -> dict[str, str]:
    """Gera o clipe de cada pauta do bloco. Devolve {pauta_id: caminho}.

    Devolve dicionário vazio (sem estourar) quando o áudio já expirou na Apify,
    quando não há ffmpeg ou quando o bloco não tem citação — nenhum desses casos
    é erro: são "não dá para conferir por áudio", e a tela diz isso.
    """
    com_citacao = [p for p in pautas if p.get("citacao") and p.get("id")]
    if not com_citacao:
        return {}
    if not ffmpeg_disponivel():
        _log("ffmpeg indisponivel — clipes de audio nao gerados")
        return {}

    run_id = bloco.get("apify_run_id")
    store_key = bloco.get("audio_store_key")
    if not (run_id and store_key):
        return {}

    saida: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        bruto = Path(tmp) / "bloco.mp3"
        if not baixar_audio_do_bloco(run_id, store_key, bruto):
            return {}
        for p in com_citacao:
            clipe = Path(tmp) / f"{p['id']}.mp3"
            if not recortar(bruto, float(p.get("ts_inicio") or 0), clipe):
                continue
            destino = f"{bloco['id']}/{p['id']}.mp3"
            if subir(clipe, destino):
                saida[p["id"]] = destino
    if saida:
        _log(f"{len(saida)} clipe(s) de audio gerados para conferencia")
    return saida


if __name__ == "__main__":
    # Autoteste das partes puras: zero rede, zero token.
    assert MARGEM_ANTES + MARGEM_DEPOIS <= DURACAO_MAX_CLIPE, \
        "a janela padrao nao pode estourar o teto do clipe"
    assert BUCKET == "radio-clipes"
    # Instante negativo (citação nos primeiros segundos) não pode virar -ss negativo.
    assert max(0.0, 1.0 - MARGEM_ANTES) == 0.0
    print("radio_clipes: autoteste OK",
          "| ffmpeg:", "disponivel" if ffmpeg_disponivel() else "AUSENTE nesta maquina")
