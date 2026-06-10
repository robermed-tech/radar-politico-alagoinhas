"""
ÁGORA — Script de teste SociaVault v2
Corrigido: tratamento robusto de campos do JSON
"""

import os
import requests
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()
SOCIAVAULT_API_KEY = os.environ.get("SOCIAVAULT_API_KEY", "SUA_API_KEY_AQUI")
PERFIS_TESTE = {
    "gustavoascarmo":       "Prefeito",
    "prefeituraalagoinhas": "Prefeitura",
    "soulucianoalmeida":    "Oposição",
    "alagonews":            "Imprensa",
}

BASE_URL = "https://api.sociavault.com"
HEADERS  = {"X-API-Key": SOCIAVAULT_API_KEY}

def checar_saldo():
    r = requests.get(f"{BASE_URL}/v1/credits", headers=HEADERS)
    if r.status_code == 200:
        data = r.json()
        creditos = data.get("credits", data.get("balance", data.get("remaining", "?")))
        print(f"\n{'='*55}")
        print(f"  Saldo SociaVault: {creditos} créditos disponíveis")
        print(f"{'='*55}")
        return creditos
    else:
        print(f"[ERRO] Saldo: {r.status_code} — {r.text}")
        return None

def extrair_campo(obj, *chaves, padrao=""):
    """Tenta múltiplos nomes de campo — robusto a variações do JSON."""
    for chave in chaves:
        if chave in obj and obj[chave] is not None:
            return obj[chave]
    return padrao

def buscar_posts(handle, categoria, limite=3):
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

    # Inspeciona estrutura real retornada
    inner = data.get("data", {})
    items_raw = inner.get("items", inner.get("posts", inner.get("data", [])))

    if isinstance(items_raw, dict):
        posts = list(items_raw.values())[:limite]
    elif isinstance(items_raw, list):
        posts = items_raw[:limite]
    else:
        posts = []

    print(f"    {len(posts)} posts | {creditos_usados} crédito(s)")

    for i, p in enumerate(posts, 1):
        url     = extrair_campo(p, "url", "link", "permalink", "shortcode")
        likes   = extrair_campo(p, "like_count", "likes", "likeCount", padrao=0)
        coments = extrair_campo(p, "comment_count", "comments", "commentCount", padrao=0)
        data_p  = extrair_campo(p, "taken_at", "timestamp", "date", "created_at")
        # Caption: tenta vários campos, converte para string antes de fatiar
        caption_raw = extrair_campo(p, "caption", "text", "description", "caption_text")
        caption = str(caption_raw)[:80] if caption_raw else "(sem legenda)"

        if "instagram.com" not in str(url):
            sc = extrair_campo(p, "shortcode", "code", "id")
            url = f"https://www.instagram.com/p/{sc}/" if sc else url

        print(f"\n    Post {i}:")
        print(f"      URL:        {url}")
        print(f"      Curtidas:   {likes}")
        print(f"      Comentários:{coments}")
        print(f"      Data:       {data_p}")
        print(f"      Caption:    {caption}...")

    # Mostra campos brutos do primeiro post para diagnóstico
    if posts:
        print(f"\n    CAMPOS BRUTOS DO POST (diagnóstico):")
        for k, v in posts[0].items():
            print(f"      {k}: {str(v)[:60]}")

    return posts

def buscar_comentarios(post_url, max_paginas=2):
    print(f"\n>>> Buscando comentários: {post_url}")
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
            print(f"    [ERRO {r.status_code}] {r.text[:300]}")
            break

        data = r.json()
        creditos_total += data.get("credits_used", 1)

        inner = data.get("data", {})
        comentarios_raw = inner.get("comments", [])

        if isinstance(comentarios_raw, dict):
            lista = list(comentarios_raw.values())
        elif isinstance(comentarios_raw, list):
            lista = comentarios_raw
        else:
            lista = []

        todos.extend(lista)
        cursor = inner.get("cursor")

        print(f"    Página {pagina}: {len(lista)} comentários | cursor: {'sim' if cursor else 'fim'}")
        if not cursor:
            break

    print(f"\n    Total: {len(todos)} comentários | {creditos_total} crédito(s)")

    print(f"\n    {'─'*50}")
    print(f"    AMOSTRA (primeiros 8 comentários):")
    print(f"    {'─'*50}")
    for c in todos[:8]:
        if isinstance(c, dict):
            usuario = extrair_campo(c.get("user", {}), "username", padrao="?")
            texto   = str(extrair_campo(c, "text", "comment", "content", padrao=""))[:100]
            data_c  = str(extrair_campo(c, "created_at", "timestamp", "date"))[:10]
            verif   = "✓" if c.get("user", {}).get("is_verified") else " "
            likes_c = extrair_campo(c, "like_count", "likes", padrao=0)
            print(f"\n    [{verif}] @{usuario} ({data_c}) ♥{likes_c}")
            print(f"        \"{texto}\"")

    # Campos brutos do primeiro comentário
    if todos and isinstance(todos[0], dict):
        print(f"\n    CAMPOS BRUTOS DO COMENTÁRIO (diagnóstico):")
        def mostrar(obj, prefixo="      "):
            for k, v in obj.items():
                if isinstance(v, dict):
                    print(f"{prefixo}{k}:")
                    mostrar(v, prefixo + "  ")
                else:
                    print(f"{prefixo}{k}: {str(v)[:60]}")
        mostrar(todos[0])

    return todos

def salvar_json(posts, comentarios, handle):
    arquivo = f"agora_resultado_{handle}.json"
    with open(arquivo, "w", encoding="utf-8") as f:
        json.dump({
            "gerado_em": datetime.now().isoformat(),
            "perfil": handle,
            "total_posts": len(posts),
            "total_comentarios": len(comentarios),
            "posts": posts,
            "comentarios": comentarios
        }, f, ensure_ascii=False, indent=2)
    print(f"\n  Dados salvos em: {arquivo}")

def main():
    print("\n" + "="*55)
    print("  ÁGORA — Teste de validação SociaVault v2")
    print("="*55)

    if "SUA_API_KEY" in SOCIAVAULT_API_KEY:
        print("\n[!] Cole sua API key no topo do script.")
        return

    checar_saldo()

    todos_posts = {}
    for handle, categoria in PERFIS_TESTE.items():
        posts = buscar_posts(handle, categoria, limite=2)
        todos_posts[handle] = posts

    # Testa comentários do primeiro post do prefeito
    comentarios_teste = []
    for handle in ["gustavoascarmo", "prefeituraalagoinhas", "soulucianoalmeida"]:
        posts = todos_posts.get(handle, [])
        if not posts:
            continue
        p = posts[0]
        url_post = extrair_campo(p, "url", "link", "permalink")
        if not url_post or "instagram.com" not in str(url_post):
            sc = extrair_campo(p, "shortcode", "code", "id")
            url_post = f"https://www.instagram.com/p/{sc}/" if sc else None
        if url_post:
            print(f"\n{'='*55}")
            print(f"  COMENTÁRIOS — @{handle}")
            comentarios_teste = buscar_comentarios(url_post, max_paginas=2)
            salvar_json(posts, comentarios_teste, handle)
            break

    print(f"\n{'='*55}")
    print("  RESULTADO FINAL")
    print(f"{'='*55}")
    perfis_ok = sum(1 for p in todos_posts.values() if p)
    print(f"  Perfis com posts:    {perfis_ok}/{len(PERFIS_TESTE)}")
    print(f"  Comentários coletados: {len(comentarios_teste)}")
    status = "✓ API OK — pronto para o ÁGORA" if perfis_ok > 0 else "✗ Verificar erros"
    print(f"  Status: {status}")
    print(f"{'='*55}\n")

if __name__ == "__main__":
    main()
