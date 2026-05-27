"""
Camada de acesso ao banco central (Supabase / PostgreSQL).

Responsabilidades:
  - Verificar duplicatas antes de qualquer análise (evita reprocessamento pelo Claude)
  - Salvar posts brutos assim que chegam do coletor (Apify / futuros coletores)
  - Salvar análises do Claude apenas para registros ainda não analisados
  - Expor helpers de leitura para o dashboard

Variáveis de ambiente necessárias (.env):
  SUPABASE_URL   = https://<projeto>.supabase.co
  SUPABASE_KEY   = <service_role_key ou anon_key>
"""

import os
from datetime import datetime, timezone

from supabase import create_client, Client


# ── Conexão ───────────────────────────────────────────────────────────────────

def conectar() -> Client:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        raise EnvironmentError(
            "SUPABASE_URL e SUPABASE_KEY devem estar definidos no .env"
        )
    return create_client(url, key)


# ── Deduplicação ──────────────────────────────────────────────────────────────

def urls_existentes_db(client: Client, fonte_id: str | None = None) -> set[str]:
    """
    Retorna o conjunto de URLs já presentes na tabela `posts`.
    Se fonte_id for informado, filtra apenas por aquela fonte.
    Usado como fonte primária de deduplicação (substitui leitura da planilha).
    """
    query = client.table("posts").select("url")
    if fonte_id:
        query = query.eq("fonte_id", fonte_id)
    resultado = query.execute()
    return {row["url"] for row in (resultado.data or [])}


# ── Inserção de post bruto ────────────────────────────────────────────────────

def salvar_post_bruto(client: Client, post: dict, fonte_id: str) -> str | None:
    """
    Salva um post bruto (pré-análise) na tabela `posts`.
    Retorna o ID gerado pelo banco ou None em caso de conflito (URL duplicada).

    O campo `analisado` começa como FALSE — o Claude só processa esses registros.
    """
    payload = {
        "url":               post["url"],
        "fonte_id":          fonte_id,
        "autor":             post.get("autor", ""),
        "categoria_perfil":  post.get("categoria", ""),
        "data_post":         post.get("data_post", ""),
        "curtidas":          post.get("curtidas", 0),
        "comentarios_count": post.get("comentarios_count", 0),
        "caption":           post.get("caption", ""),
        "analisado":         False,
        "coletado_em":       datetime.now(timezone.utc).isoformat(),
    }
    try:
        res = (
            client.table("posts")
            .insert(payload, returning="representation")
            .execute()
        )
        if res.data:
            return res.data[0]["id"]
    except Exception as e:
        # Conflito de URL duplicada (constraint único) — silencia
        if "duplicate" in str(e).lower() or "23505" in str(e):
            return None
        raise
    return None


# ── Inserção de análise ───────────────────────────────────────────────────────

def salvar_analise(client: Client, post_id: str, analise: dict, comentarios: list[str]) -> None:
    """
    Salva o resultado da análise do Claude na tabela `analises` e
    marca o post como `analisado = TRUE` na tabela `posts`.
    Operação atômica via upsert — segura para reprocessamentos pontuais.
    """
    payload_analise = {
        "post_id":                     post_id,
        "sentimento_post":             analise.get("sentimento_post", ""),
        "sentimento_comentarios":      analise.get("sentimento_comentarios", ""),
        "comentarios_negativos_pct":   analise.get("comentarios_negativos_pct", ""),
        "comentarios_positivos_pct":   analise.get("comentarios_positivos_pct", ""),
        "comentarios_positivos_texto": analise.get("comentarios_positivos_texto", ""),
        "comentarios_negativos_texto": analise.get("comentarios_negativos_texto", ""),
        "comentarios_destaque":        analise.get("comentarios_destaque", ""),
        "tema":                        analise.get("tema", ""),
        "tema_sensivel":               analise.get("tema_sensivel", ""),
        "urgencia":                    analise.get("urgencia", ""),
        "risco_crise":                 analise.get("risco_crise", ""),
        "tendencia":                   analise.get("tendencia", ""),
        "engajamento":                 analise.get("engajamento", ""),
        "resumo":                      analise.get("resumo", ""),
        "atribuicao":                  analise.get("atribuicao", ""),
        "sugestao_acao":               analise.get("sugestao_acao", ""),
        "total_comentarios":           len(comentarios),
        "comentaristas":               ", ".join(
            sorted({c.split(":")[0].strip() for c in comentarios if ":" in c})[:10]
        ),
        "analisado_em": datetime.now(timezone.utc).isoformat(),
    }

    # Salva análise
    client.table("analises").upsert(payload_analise, on_conflict="post_id").execute()

    # Marca post como analisado
    client.table("posts").update({"analisado": True}).eq("id", post_id).execute()


# ── Salvar comentários individuais (opcional — Dia 6+) ────────────────────────

def salvar_comentarios(client: Client, post_id: str, comentarios: list[str]) -> None:
    """
    Salva os comentários relevantes na tabela `comentarios`.
    Chamada opcional — enriquece o banco para análises futuras.
    """
    if not comentarios:
        return
    rows = []
    for entrada in comentarios:
        if ":" in entrada:
            autor_c, texto_c = entrada.split(":", 1)
        else:
            autor_c, texto_c = "anon", entrada
        rows.append({
            "post_id":    post_id,
            "autor":      autor_c.strip(),
            "texto":      texto_c.strip(),
            "coletado_em": datetime.now(timezone.utc).isoformat(),
        })
    client.table("comentarios").insert(rows).execute()


# ── Buscar posts não analisados (para reprocessamento futuro) ─────────────────

def posts_nao_analisados(client: Client, fonte_id: str | None = None, limite: int = 50) -> list[dict]:
    """
    Retorna posts que ainda não foram analisados pelo Claude.
    Útil para reprocessamentos sob demanda sem precisar re-coletar do Apify.
    """
    query = (
        client.table("posts")
        .select("*")
        .eq("analisado", False)
        .limit(limite)
        .order("coletado_em", desc=False)
    )
    if fonte_id:
        query = query.eq("fonte_id", fonte_id)
    resultado = query.execute()
    return resultado.data or []
