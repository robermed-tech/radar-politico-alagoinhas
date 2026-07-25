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
    python limpar_posts_irrelevantes.py                    # simulacao + backup
    python limpar_posts_irrelevantes.py --apagar           # efetiva a remocao
    python limpar_posts_irrelevantes.py --so-outra-cidade  # restringe o alvo

`--so-outra-cidade` remove APENAS os posts de imprensa que falam da gestao de
OUTRO municipio (keyword generica sem ancora do tenant: noticia sobre o
prefeito de Cardeal da Silva, de Jequie, politica nacional). Esse descarte e
inequivoco: o post nunca deveria ter entrado na base de Alagoinhas.
Fica de fora os posts descartados por "nenhuma keyword cadastrada", que
incluem critica local legitima que so nao nomeia a cidade — esses dependem de
o cliente cadastrar o termo que falta na tela Relevancia, e apagar antes
disso jogaria fora dado recuperavel.

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
SO_OUTRA_CIDADE = "--so-outra-cidade" in sys.argv

# --exceto ARQUIVO: uma URL por linha, posts que a revisao humana decidiu
# preservar. Existe porque a ancora exigida da imprensa gera falso positivo
# quando o veiculo LOCAL escreve sobre um bairro ou orgao daqui sem repetir o
# nome da cidade ("Jardim Petrolar", "SMT", handle de vereador cadastrado).
# Conferir a lista antes de apagar faz parte do procedimento, nao e opcional.
EXCETO = set()
if "--exceto" in sys.argv:
    _i = sys.argv.index("--exceto")
    with open(sys.argv[_i + 1], encoding="utf-8") as _f:
        EXCETO = {ln.strip() for ln in _f if ln.strip()}

# Marca que _motivo_relevancia usa quando a imprensa cita uma gestao generica
# sem nenhuma ancora do municipio — ou seja, noticia de outra cidade.
MARCA_OUTRA_CIDADE = "sem ancora do municipio"
U = os.environ["SUPABASE_URL"]; K = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}"}
HJ = {**H, "Content-Type": "application/json", "Prefer": "return=representation"}

posts = requests.get(f"{U}/rest/v1/posts", params={
    "tenant": "eq.alagoinhas", "select": "*", "limit": "5000"}, headers=H).json()

fora = []
for p in posts:
    handle = (p.get("autor") or "").lower()
    filtro = agora.PERFIS.get(handle, {"filtro": "governo"})["filtro"]
    # Perfis de governo tambem entram na varredura desde a revisao de 25/07:
    # o clima so pode ser formado por conteudo relacionado as palavras da tela
    # Relevancia, inclusive nas contas oficiais da gestao.
    passou, motivo = agora._motivo_relevancia(p.get("caption") or "", filtro)
    if not passou:
        if SO_OUTRA_CIDADE and MARCA_OUTRA_CIDADE not in motivo:
            continue
        if p.get("url") in EXCETO:
            print(f"  preservado pela revisao: {p.get('url')}")
            continue
        p["_motivo_descarte"] = motivo
        fora.append(p)

urls = [p["url"] for p in fora if p.get("url")]
alvo = "posts de OUTRA CIDADE" if SO_OUTRA_CIDADE else "posts irrelevantes"
print(f"{alvo} a remover: {len(fora)}")

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
