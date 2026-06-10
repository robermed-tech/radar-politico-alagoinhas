"""
ÁGORA — Script de teste SociaVault
Valida se a API retorna posts e comentários no formato correto
antes de migrar do Apify.

Como usar:
1. pip install requests --break-system-packages
2. python agora_teste_sociavault.py
"""

import os
import requests
import json
from datetime import datetime
from dotenv import load_dotenv

# ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────
load_dotenv()
SOCIAVAULT_API_KEY = os.environ.get("SOCIAVAULT_API_KEY", "SUA_API_KEY_AQUI")

# Perfis monitorados pelo ÁGORA (altere conforme necessário)
PERFIS_TESTE = {
    "gustavoascarmo":       "Prefeito",
    "prefeituraalagoinhas": "Prefeitura",
    "soulucianoalmeida":    "Oposição",
    "alagonews":            "Imprensa",
}

BASE_URL = "https://api.sociavault.com"
HEADERS  = {"X-API-Key": SOCIAVAULT_API_KEY}

# ─── FUNÇÕES ─────────────────────────────────────────────────────────────────

def checar_saldo():
    """Mostra quantos créditos restam."""
    r = requests.get(f"{BASE_URL}/v1/credits", headers=HEADERS)
    if r.status_code == 200:
        data = r.json()
        creditos = data.get("credits", data.get("balance", "?"))
        print(f"\n{'='*55}")
        print(f"  Saldo SociaVault: {creditos} créditos disponíveis")
        print(f"{'='*55}")
        return creditos
    else:
        print(f"[ERRO] Não foi possível checar saldo: {r.status_code} — {r.text}")
        return None

def buscar_posts(handle, categoria, limite=3):
    """Busca os últimos posts de um perfil."""
    print(f"\n>>> Buscando posts de @{handle} ({categoria})...")
    r = requests.get(
        f"{BASE_URL}/v1/scrape/instagram/posts",
        headers=HEADERS,
        params={"handle": handle}
    )
    if r.status_code != 200:
        print(f"    [ERRO {r.status_code}] {r.text[:200]}")
        return []

    data = r.json()
    creditos_usados = data.get("credits_used", "?")
    items = data.get("data", {}).get("items", {})

    if isinstance(items, dict):
        posts = list(items.values())[:limite]
    elif isinstance(items, list):
        posts = items[:limite]
    else:
        posts = []

    print(f"    {len(posts)} posts retornados | {creditos_usados} crédito(s) usado(s)")

    for i, p in enumerate(posts, 1):
        url     = p.get("url") or p.get("shortcode") or p.get("link", "")
        likes   = p.get("like_count") or p.get("likes", 0)
        coments = p.get("comment_count") or p.get("comments", 0)
        data_p  = p.get("taken_at") or p.get("timestamp", "")
        caption = (p.get("caption") or p.get("text") or "")[:80]
        print(f"\n    Post {i}:")
        print(f"      URL:        {url}")
        print(f"      Curtidas:   {likes}")
        print(f"      Comentários:{coments}")
        print(f"      Data:       {data_p}")
        print(f"      Caption:    {caption}...")

    return posts

def buscar_comentarios(post_url, max_paginas=2):
    """
    Busca comentários individuais de um post — o coração do termômetro do ÁGORA.
    Retorna até max_paginas × ~15 comentários.
    """
    print(f"\n>>> Buscando comentários de: {post_url}")
    todos = []
    cursor = None
    creditos_total = 0

    for pagina in range(1, max_paginas + 1):
        params = {"url": post_url}
        if cursor:
            params["cursor"] = cursor

        r = requests.get(
            f"{BASE_URL}/v1/scrape/instagram/comments",
            headers=HEADERS,
            params=params
        )

        if r.status_code != 200:
            print(f"    [ERRO {r.status_code}] {r.text[:200]}")
            break

        data = r.json()
        creditos_total += data.get("credits_used", 1)
        comentarios = data.get("data", {}).get("comments", {})

        if isinstance(comentarios, dict):
            lista = list(comentarios.values())
        elif isinstance(comentarios, list):
            lista = comentarios
        else:
            lista = []

        todos.extend(lista)
        cursor = data.get("data", {}).get("cursor")

        print(f"    Página {pagina}: {len(lista)} comentários | cursor: {'sim' if cursor else 'fim'}")

        if not cursor:
            break

    print(f"\n    Total: {len(todos)} comentários | {creditos_total} crédito(s) usado(s)")

    # Exibe amostra dos comentários
    print(f"\n    {'─'*50}")
    print(f"    AMOSTRA DE COMENTÁRIOS (primeiros 5):")
    print(f"    {'─'*50}")
    for c in todos[:5]:
        usuario   = c.get("user", {}).get("username", "desconhecido")
        texto     = c.get("text", "")[:100]
        data_c    = c.get("created_at", "")[:10]
        verificado= "✓" if c.get("user", {}).get("is_verified") else " "
        print(f"\n    [{verificado}] @{usuario} ({data_c})")
        print(f"        \"{texto}\"")

    return todos

def analisar_estrutura_json(comentarios):
    """Mostra os campos disponíveis no JSON de comentários."""
    if not comentarios:
        return
    print(f"\n{'='*55}")
    print("  CAMPOS DISPONÍVEIS NO JSON DE COMENTÁRIO:")
    print(f"{'='*55}")
    primeiro = comentarios[0]
    for chave, valor in primeiro.items():
        tipo = type(valor).__name__
        print(f"  {chave:<20} → {tipo}")
        if isinstance(valor, dict):
            for sub, sv in valor.items():
                print(f"    .{sub:<18} → {type(sv).__name__}")

def salvar_resultado(posts, comentarios, handle):
    """Salva os dados crus para inspeção."""
    arquivo = f"/mnt/user-data/outputs/agora_teste_{handle}.json"
    with open(arquivo, "w", encoding="utf-8") as f:
        json.dump({
            "gerado_em": datetime.now().isoformat(),
            "perfil": handle,
            "posts": posts,
            "comentarios": comentarios
        }, f, ensure_ascii=False, indent=2)
    print(f"\n  Dados salvos em: {arquivo}")

# ─── EXECUÇÃO DO TESTE ────────────────────────────────────────────────────────

def main():
    print("\n" + "="*55)
    print("  ÁGORA — Teste de validação SociaVault")
    print("="*55)

    if SOCIAVAULT_API_KEY == "SUA_API_KEY_AQUI":
        print("\n[!] Configure sua API key no topo do script antes de rodar.")
        print("    Acesse: https://sociavault.com/dashboard")
        return

    # 1. Saldo
    saldo = checar_saldo()
    if saldo is not None and int(saldo) < 10:
        print("[AVISO] Créditos baixos. O teste pode consumir ~5-10 créditos.")

    # 2. Testa posts de cada perfil
    todos_posts = {}
    for handle, categoria in PERFIS_TESTE.items():
        posts = buscar_posts(handle, categoria, limite=3)
        todos_posts[handle] = posts

    # 3. Testa comentários do primeiro post disponível
    comentarios_teste = []
    for handle, posts in todos_posts.items():
        if posts:
            url_post = (
                posts[0].get("url") or
                posts[0].get("link") or
                f"https://www.instagram.com/p/{posts[0].get('shortcode', '')}"
            )
            if url_post and "instagram.com" in url_post:
                print(f"\n{'='*55}")
                print(f"  TESTE DE COMENTÁRIOS — @{handle}")
                comentarios_teste = buscar_comentarios(url_post, max_paginas=2)
                analisar_estrutura_json(comentarios_teste)
                salvar_resultado(posts, comentarios_teste, handle)
                break  # Testa só o primeiro perfil com post disponível

    # 4. Resumo final
    print(f"\n{'='*55}")
    print("  RESULTADO DO TESTE")
    print(f"{'='*55}")
    perfis_ok = sum(1 for p in todos_posts.values() if p)
    print(f"  Perfis com posts retornados: {perfis_ok}/{len(PERFIS_TESTE)}")
    print(f"  Comentários coletados:       {len(comentarios_teste)}")
    print(f"  Status: {'✓ API funcionando' if perfis_ok > 0 and comentarios_teste else '✗ Verificar erros acima'}")
    print(f"{'='*55}\n")

if __name__ == "__main__":
    main()
