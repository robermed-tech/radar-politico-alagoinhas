"""Remove da base os posts que o criterio de relevancia corrigido descarta.

Existe porque a correcao do filtro (PR #43) so vale para coletas NOVAS: os
posts sobre outras cidades que ja entraram continuam pesando nos indices e no
termometro ate serem removidos.

Fluxo seguro:
  1. identifica os posts irrelevantes usando a MESMA funcao que o pipeline usa
     (agora.py::_motivo_relevancia) — nao ha criterio duplicado aqui
  2. grava BACKUP completo (posts + comentarios) em JSON antes de tocar em nada
  3. so entao apaga comentarios e, depois, posts

Uso:
    python limpar_posts_irrelevantes.py            # simulacao + backup
    python limpar_posts_irrelevantes.py --apagar   # efetiva a remocao

O backup fica ao lado do script e permite reinserir tudo via PostgREST se a
limpeza se mostrar agressiva demais. Depois de rodar, vale disparar o pipeline
(ou esperar a proxima execucao) para os agregados diarios se recomporem.
"""
import os, sys, json, datetime
for v in ("APIFY_API_TOKEN", "EVOLUTION_API_KEY", "ANTHROPIC_API_KEY"):
    os.environ.pop(v, None)
import requests
import agora

APAGAR = "--apagar" in sys.argv
U = os.environ["SUPABASE_URL"]; K = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}"}
HJ = {**H, "Content-Type": "application/json", "Prefer": "return=representation"}

posts = requests.get(f"{U}/rest/v1/posts", params={
    "tenant": "eq.alagoinhas", "select": "*", "limit": "5000"}, headers=H).json()

fora = []
for p in posts:
    handle = (p.get("autor") or "").lower()
    filtro = agora.PERFIS.get(handle, {"filtro": "governo"})["filtro"]
    if filtro == "governo":
        continue
    passou, motivo = agora._motivo_relevancia(p.get("caption") or "", filtro)
    if not passou:
        p["_motivo_descarte"] = motivo
        fora.append(p)

urls = [p["url"] for p in fora if p.get("url")]
print(f"posts a remover: {len(fora)}")

# Comentarios ligados a esses posts (join por url_post, como o resto do codigo faz)
coments = []
for i in range(0, len(urls), 40):
    lote = urls[i:i + 40]
    lista = ",".join('"' + u.replace('"', '') + '"' for u in lote)
    r = requests.get(f"{U}/rest/v1/comments", params={
        "tenant": "eq.alagoinhas", "url_post": f"in.({lista})",
        "select": "*", "limit": "5000"}, headers=H)
    if r.status_code == 200:
        coments.extend(r.json())
    else:
        print("  ERRO ao ler comentarios:", r.status_code, r.text[:200]); sys.exit(1)
print(f"comentarios ligados a eles: {len(coments)}")

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bkp = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"backup-irrelevantes-{stamp}.json")
with open(bkp, "w", encoding="utf-8") as f:
    json.dump({"gerado_em": stamp, "posts": fora, "comments": coments}, f, ensure_ascii=False, indent=1)
print(f"backup salvo: {bkp}")

if not APAGAR:
    print("\n[SIMULACAO] nada foi alterado. Rode com --apagar para efetivar.")
    sys.exit(0)

# 1) comentarios primeiro (evita orfaos se algo falhar no meio)
apagados_c = 0
for i in range(0, len(urls), 40):
    lote = urls[i:i + 40]
    lista = ",".join('"' + u.replace('"', '') + '"' for u in lote)
    r = requests.delete(f"{U}/rest/v1/comments",
                        params={"tenant": "eq.alagoinhas", "url_post": f"in.({lista})"},
                        headers=HJ)
    if r.status_code not in (200, 204):
        print("  ERRO apagando comentarios:", r.status_code, r.text[:200]); sys.exit(1)
    apagados_c += len(r.json()) if r.text.strip().startswith("[") else 0
print(f"comentarios apagados: {apagados_c}")

# 2) posts
apagados_p = 0
for i in range(0, len(urls), 40):
    lote = urls[i:i + 40]
    lista = ",".join('"' + u.replace('"', '') + '"' for u in lote)
    r = requests.delete(f"{U}/rest/v1/posts",
                        params={"tenant": "eq.alagoinhas", "url": f"in.({lista})"},
                        headers=HJ)
    if r.status_code not in (200, 204):
        print("  ERRO apagando posts:", r.status_code, r.text[:200]); sys.exit(1)
    apagados_p += len(r.json()) if r.text.strip().startswith("[") else 0
print(f"posts apagados: {apagados_p}")
print("\nOK. Backup em:", bkp)
