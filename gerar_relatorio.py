"""
RADAR POLÍTICO ALAGOINHAS — Relatório PDF Semanal
==================================================
Gera dois PDFs toda sexta às 18h BRT:
  - Resumo executivo (1-2 páginas)
  - Relatório completo (gráficos, tabelas, top posts, padrões)
Envia ambos diretamente pelo WhatsApp via Evolution API (sem Google Drive).
"""

import os
import io
import base64
import requests
import gspread
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

load_dotenv()

# ── Credenciais ───────────────────────────────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
GOOGLE_SHEET_ID             = os.environ["GOOGLE_SHEET_ID"]
GOOGLE_SHEET_NAME           = os.environ.get("GOOGLE_SHEET_NAME", "Radar")
EVOLUTION_API_URL           = os.environ.get("EVOLUTION_API_URL", "")
EVOLUTION_API_KEY           = os.environ.get("EVOLUTION_API_KEY", "")
EVOLUTION_INSTANCE          = os.environ.get("EVOLUTION_INSTANCE", "radar-politico")
EVOLUTION_GROUP_ID          = os.environ.get("EVOLUTION_GROUP_ID", "")

# ── Cores institucionais ──────────────────────────────────────────────────────
COR_PRIMARIA   = colors.HexColor("#1a3a5c")
COR_SECUNDARIA = colors.HexColor("#2e7d32")
COR_ALERTA     = colors.HexColor("#c62828")
COR_AVISO      = colors.HexColor("#e65100")
COR_FUNDO      = colors.HexColor("#f5f5f5")
COR_LINHA      = colors.HexColor("#e0e0e0")


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE SHEETS
# ═══════════════════════════════════════════════════════════════════════════════

def conectar_sheets():
    creds = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    gc = gspread.authorize(creds)
    return gc.open_by_key(GOOGLE_SHEET_ID)


def carregar_dados_semana(sh):
    ws = sh.worksheet(GOOGLE_SHEET_NAME)
    dados = ws.get_all_records()
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    recentes = []
    for row in dados:
        try:
            dt = datetime.strptime(str(row.get("data_post", "")), "%d/%m/%Y %H:%M")
            dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                recentes.append(row)
        except Exception:
            continue
    return recentes


def calcular_estatisticas(dados):
    if not dados:
        return {}
    total       = len(dados)
    positivos   = sum(1 for r in dados if str(r.get("sentimento_post","")).lower() == "positivo")
    negativos   = sum(1 for r in dados if str(r.get("sentimento_post","")).lower() == "negativo")
    neutros     = total - positivos - negativos
    alto_risco  = sum(1 for r in dados if str(r.get("risco_crise","")).lower() == "alto")
    medio_risco = sum(1 for r in dados if str(r.get("risco_crise","")).lower() == "médio")
    crescendo   = sum(1 for r in dados if str(r.get("tendencia","")).lower() == "crescendo")
    scores      = [int(r.get("score_risco", 0) or 0) for r in dados]
    score_medio = sum(scores) // len(scores) if scores else 0
    score_max   = max(scores) if scores else 0
    por_categoria = {}
    for r in dados:
        cat = r.get("categoria_perfil", "Outro")
        por_categoria[cat] = por_categoria.get(cat, 0) + 1
    por_tema = {}
    for r in dados:
        tema = r.get("tema", "Outro")
        por_tema[tema] = por_tema.get(tema, 0) + 1
    top_temas  = sorted(por_tema.items(), key=lambda x: x[1], reverse=True)[:5]
    top_posts  = sorted(dados, key=lambda x: int(x.get("score_risco", 0) or 0), reverse=True)[:5]
    por_perfil = {}
    for r in dados:
        autor = r.get("autor", "")
        por_perfil[autor] = por_perfil.get(autor, 0) + 1
    top_perfis = sorted(por_perfil.items(), key=lambda x: x[1], reverse=True)[:5]
    por_acao   = {}
    for r in dados:
        acao = r.get("sugestao_acao", "Monitorar")
        por_acao[acao] = por_acao.get(acao, 0) + 1
    total_curtidas    = sum(int(r.get("curtidas", 0) or 0) for r in dados)
    total_comentarios = sum(int(r.get("comentarios_count", 0) or 0) for r in dados)
    return {
        "total": total, "positivos": positivos, "negativos": negativos,
        "neutros": neutros, "alto_risco": alto_risco, "medio_risco": medio_risco,
        "crescendo": crescendo, "score_medio": score_medio, "score_max": score_max,
        "por_categoria": por_categoria, "top_temas": top_temas, "top_posts": top_posts,
        "top_perfis": top_perfis, "por_acao": por_acao,
        "total_curtidas": total_curtidas, "total_comentarios": total_comentarios,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  ESTILOS
# ═══════════════════════════════════════════════════════════════════════════════

def criar_estilos():
    base = getSampleStyleSheet()
    return {
        "titulo_doc": ParagraphStyle("titulo_doc", parent=base["Title"], fontSize=22,
            textColor=COR_PRIMARIA, spaceAfter=6, alignment=TA_CENTER, fontName="Helvetica-Bold"),
        "subtitulo": ParagraphStyle("subtitulo", parent=base["Normal"], fontSize=11,
            textColor=colors.HexColor("#555555"), spaceAfter=20, alignment=TA_CENTER),
        "secao": ParagraphStyle("secao", parent=base["Heading1"], fontSize=13,
            textColor=COR_PRIMARIA, spaceBefore=16, spaceAfter=8, fontName="Helvetica-Bold"),
        "normal": ParagraphStyle("normal", parent=base["Normal"], fontSize=9, leading=14, spaceAfter=4),
        "alerta": ParagraphStyle("alerta", parent=base["Normal"], fontSize=9,
            textColor=COR_ALERTA, fontName="Helvetica-Bold"),
        "rodape": ParagraphStyle("rodape", parent=base["Normal"], fontSize=7,
            textColor=colors.grey, alignment=TA_CENTER),
        "card_titulo": ParagraphStyle("card_titulo", parent=base["Normal"], fontSize=10,
            fontName="Helvetica-Bold", textColor=COR_PRIMARIA),
        "card_body": ParagraphStyle("card_body", parent=base["Normal"], fontSize=8, leading=12),
    }


def tabela_padrao(dados, cabecalho, col_widths=None):
    t = Table([cabecalho] + dados, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), COR_PRIMARIA),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("ALIGN",         (0, 0), (-1, 0), "CENTER"),
        ("FONTSIZE",      (0, 1), (-1, -1), 8),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, COR_FUNDO]),
        ("GRID",          (0, 0), (-1, -1), 0.5, COR_LINHA),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
    ]))
    return t


def barra_score(score):
    if score >= 70: return COR_ALERTA
    elif score >= 40: return COR_AVISO
    return COR_SECUNDARIA


# ═══════════════════════════════════════════════════════════════════════════════
#  RESUMO EXECUTIVO
# ═══════════════════════════════════════════════════════════════════════════════

def gerar_resumo_executivo(dados, stats, periodo):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    estilos = criar_estilos()
    story = []

    story.append(Paragraph("RADAR POLÍTICO ALAGOINHAS", estilos["titulo_doc"]))
    story.append(Paragraph("Resumo Executivo Semanal", estilos["subtitulo"]))
    story.append(Paragraph(f"Período: {periodo}", estilos["subtitulo"]))
    story.append(HRFlowable(width="100%", thickness=2, color=COR_PRIMARIA))
    story.append(Spacer(1, 12))

    story.append(Paragraph("VISÃO GERAL DA SEMANA", estilos["secao"]))
    pct_neg = round(stats["negativos"] / stats["total"] * 100) if stats["total"] else 0
    pct_pos = round(stats["positivos"] / stats["total"] * 100) if stats["total"] else 0

    metricas = [
        ["📊 Posts Analisados", "😊 Sentimento Positivo", "😠 Sentimento Negativo", "🚨 Alto Risco"],
        [str(stats["total"]), f"{stats['positivos']} ({pct_pos}%)",
         f"{stats['negativos']} ({pct_neg}%)", str(stats["alto_risco"])],
    ]
    t1 = Table(metricas, colWidths=[4.2*cm]*4)
    t1.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), COR_PRIMARIA),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 8),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("FONTNAME",      (0, 1), (-1, 1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 1), (-1, 1), 18),
        ("TEXTCOLOR",     (3, 1), (3, 1), COR_ALERTA),
        ("BACKGROUND",    (0, 1), (-1, 1), COR_FUNDO),
        ("GRID",          (0, 0), (-1, -1), 0.5, COR_LINHA),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t1)
    story.append(Spacer(1, 16))

    story.append(Paragraph("TOP 3 ALERTAS DA SEMANA", estilos["secao"]))
    for i, post in enumerate(stats["top_posts"][:3], 1):
        score = int(post.get("score_risco", 0) or 0)
        cor_s = barra_score(score)
        emoji = "🔴" if score >= 70 else "🟠" if score >= 40 else "🟢"
        cab = [[
            Paragraph(f"{emoji} {i}. @{post.get('autor','')} — {post.get('tema','')}", estilos["card_titulo"]),
            Paragraph(f"Score: {score}/100", ParagraphStyle("sc", fontSize=11,
                fontName="Helvetica-Bold", textColor=cor_s, alignment=TA_RIGHT)),
        ]]
        corpo = [[
            Paragraph(post.get("resumo", "")[:120], estilos["card_body"]),
            Paragraph(f"Ação: {post.get('sugestao_acao','')}", estilos["card_body"]),
        ]]
        t_cab = Table(cab, colWidths=[12*cm, 4.8*cm])
        t_cab.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), COR_PRIMARIA),
            ("TEXTCOLOR",  (0,0), (-1,-1), colors.white),
            ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6),
            ("LEFTPADDING",(0,0), (-1,-1), 8),
        ]))
        t_corp = Table(corpo, colWidths=[12*cm, 4.8*cm])
        t_corp.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), COR_FUNDO),
            ("GRID", (0,0), (-1,-1), 0.5, COR_LINHA),
            ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
            ("LEFTPADDING",(0,0), (-1,-1), 8),
        ]))
        story.append(t_cab)
        story.append(t_corp)
        story.append(Spacer(1, 6))

    story.append(Spacer(1, 12))
    story.append(Paragraph("TEMAS DOMINANTES", estilos["secao"]))
    if stats["top_temas"]:
        dados_temas = [[tema, str(count), f"{round(count/stats['total']*100)}%"]
                       for tema, count in stats["top_temas"]]
        story.append(tabela_padrao(dados_temas, ["Tema", "Posts", "% do Total"],
                                   col_widths=[10*cm, 3*cm, 3.8*cm]))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Radar Político Alagoinhas | {datetime.now().strftime('%d/%m/%Y %H:%M')} | Confidencial",
        estilos["rodape"]))
    doc.build(story)
    buffer.seek(0)
    return buffer


# ═══════════════════════════════════════════════════════════════════════════════
#  RELATÓRIO COMPLETO
# ═══════════════════════════════════════════════════════════════════════════════

def gerar_relatorio_completo(dados, stats, periodo):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    estilos = criar_estilos()
    story = []

    # Capa
    story.append(Spacer(1, 3*cm))
    story.append(Paragraph("RADAR POLÍTICO", estilos["titulo_doc"]))
    story.append(Paragraph("ALAGOINHAS / BA", ParagraphStyle("cidade", fontSize=16,
        textColor=COR_SECUNDARIA, alignment=TA_CENTER, fontName="Helvetica-Bold", spaceAfter=8)))
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="60%", thickness=3, color=COR_PRIMARIA, hAlign="CENTER"))
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Relatório Semanal Completo", estilos["subtitulo"]))
    story.append(Paragraph(f"Período: {periodo}", estilos["subtitulo"]))
    story.append(Paragraph(f"Gerado em: {datetime.now().strftime('%d/%m/%Y às %H:%M')}", estilos["subtitulo"]))
    story.append(Spacer(1, 2*cm))

    score_medio = stats.get("score_medio", 0)
    if score_medio >= 70:
        nivel_risco, cor_nivel = "ALTO", COR_ALERTA
    elif score_medio >= 40:
        nivel_risco, cor_nivel = "MÉDIO", COR_AVISO
    else:
        nivel_risco, cor_nivel = "BAIXO", COR_SECUNDARIA

    t_nivel = Table([[Paragraph(f"NÍVEL DE RISCO GERAL DA SEMANA: {nivel_risco}",
        ParagraphStyle("nivel", fontSize=14, fontName="Helvetica-Bold",
            textColor=colors.white, alignment=TA_CENTER))]], colWidths=[16.8*cm])
    t_nivel.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), cor_nivel),
        ("TOPPADDING", (0,0), (-1,-1), 12), ("BOTTOMPADDING", (0,0), (-1,-1), 12),
    ]))
    story.append(t_nivel)
    story.append(PageBreak())

    # Seção 1
    story.append(Paragraph("1. ESTATÍSTICAS GERAIS DA SEMANA", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    pct_neg = round(stats["negativos"] / stats["total"] * 100) if stats["total"] else 0
    pct_pos = round(stats["positivos"] / stats["total"] * 100) if stats["total"] else 0
    pct_neu = 100 - pct_neg - pct_pos
    dados_geral = [
        ["Total de posts analisados", str(stats["total"]), "Todos os perfis monitorados"],
        ["Sentimento positivo", f"{stats['positivos']} ({pct_pos}%)", "Posts favoráveis à gestão"],
        ["Sentimento negativo", f"{stats['negativos']} ({pct_neg}%)", "Posts críticos ou de risco"],
        ["Sentimento neutro", f"{stats['neutros']} ({pct_neu}%)", "Informativos / sem posição"],
        ["Alto risco", str(stats["alto_risco"]), "Requerem ação imediata"],
        ["Risco médio", str(stats["medio_risco"]), "Requerem monitoramento ativo"],
        ["Tendência crescendo", str(stats["crescendo"]), "Posts com engajamento em alta"],
        ["Score médio de risco", f"{stats['score_medio']}/100", "Média ponderada da semana"],
        ["Score máximo registrado", f"{stats['score_max']}/100", "Post mais crítico da semana"],
        ["Total de curtidas", f"{stats['total_curtidas']:,}".replace(",","."), "Engajamento total"],
        ["Total de comentários", f"{stats['total_comentarios']:,}".replace(",","."), "Interações totais"],
    ]
    story.append(tabela_padrao(dados_geral, ["Métrica", "Valor", "Observação"],
                               col_widths=[7*cm, 4*cm, 5.8*cm]))
    story.append(Spacer(1, 16))

    # Seção 2
    story.append(Paragraph("2. POSTS POR CATEGORIA DE PERFIL", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    if stats["por_categoria"]:
        dados_cat = [[cat, str(count), f"{round(count/stats['total']*100)}%"]
                     for cat, count in sorted(stats["por_categoria"].items(), key=lambda x: x[1], reverse=True)]
        story.append(tabela_padrao(dados_cat, ["Categoria", "Posts", "% do Total"],
                                   col_widths=[8*cm, 4*cm, 4.8*cm]))
    story.append(Spacer(1, 16))

    # Seção 3
    story.append(Paragraph("3. TEMAS DOMINANTES NA SEMANA", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    if stats["top_temas"]:
        dados_temas = [[tema, str(count), f"{round(count/stats['total']*100)}%"]
                       for tema, count in stats["top_temas"]]
        story.append(tabela_padrao(dados_temas, ["Tema", "Posts", "% do Total"],
                                   col_widths=[8*cm, 4*cm, 4.8*cm]))
    story.append(Spacer(1, 16))

    # Seção 4
    story.append(Paragraph("4. PERFIS MAIS ATIVOS", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    if stats["top_perfis"]:
        dados_perfis = [[f"@{perfil}", str(count), ""] for perfil, count in stats["top_perfis"]]
        story.append(tabela_padrao(dados_perfis, ["Perfil", "Posts na Semana", "Observação"],
                                   col_widths=[7*cm, 4*cm, 5.8*cm]))
    story.append(Spacer(1, 16))

    # Seção 5
    story.append(Paragraph("5. TOP 5 POSTS POR SCORE DE RISCO", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    for i, post in enumerate(stats["top_posts"], 1):
        score    = int(post.get("score_risco", 0) or 0)
        cor_s    = barra_score(score)
        emoji    = "🔴" if score >= 70 else "🟠" if score >= 40 else "🟢"
        categoria = post.get("categoria_perfil", "")
        padrao   = post.get("padrao_detectado", "Isolado")
        cab = [[
            Paragraph(f"{emoji} #{i} — @{post.get('autor','')} ({categoria})", estilos["card_titulo"]),
            Paragraph(f"Score: {score}/100", ParagraphStyle("sc2", fontSize=12,
                fontName="Helvetica-Bold", textColor=cor_s, alignment=TA_RIGHT)),
        ]]
        corpo = [
            [Paragraph(f"<b>Tema:</b> {post.get('tema','')} | <b>Urgência:</b> {post.get('urgencia','')} | <b>Risco:</b> {post.get('risco_crise','')}", estilos["card_body"]),
             Paragraph(f"<b>Data:</b> {post.get('data_post','')}", estilos["card_body"])],
            [Paragraph(f"<b>Resumo:</b> {post.get('resumo','')}", estilos["card_body"]),
             Paragraph(f"<b>Ação:</b> {post.get('sugestao_acao','')}", estilos["card_body"])],
        ]
        if padrao and padrao != "Isolado":
            corpo.append([Paragraph(f"<b>Padrão:</b> {padrao}", estilos["alerta"]),
                          Paragraph("", estilos["card_body"])])
        t_cab = Table(cab, colWidths=[12*cm, 4.8*cm])
        t_cab.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), COR_PRIMARIA), ("TEXTCOLOR", (0,0), (-1,-1), colors.white),
            ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6),
            ("LEFTPADDING",(0,0), (-1,-1), 8),
        ]))
        t_corp = Table(corpo, colWidths=[12*cm, 4.8*cm])
        t_corp.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), COR_FUNDO), ("GRID", (0,0), (-1,-1), 0.5, COR_LINHA),
            ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
            ("LEFTPADDING",(0,0), (-1,-1), 8),
        ]))
        story.append(t_cab)
        story.append(t_corp)
        story.append(Spacer(1, 10))

    # Seção 6
    story.append(PageBreak())
    story.append(Paragraph("6. DISTRIBUIÇÃO DE AÇÕES RECOMENDADAS", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    if stats["por_acao"]:
        dados_acoes = [[acao, str(count), f"{round(count/stats['total']*100)}%"]
                       for acao, count in sorted(stats["por_acao"].items(), key=lambda x: x[1], reverse=True)]
        story.append(tabela_padrao(dados_acoes, ["Ação Recomendada", "Posts", "% do Total"],
                                   col_widths=[9*cm, 3*cm, 4.8*cm]))
    story.append(Spacer(1, 16))

    # Seção 7
    story.append(Paragraph("7. TODOS OS POSTS ANALISADOS NA SEMANA", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))
    dados_todos = sorted(dados, key=lambda x: int(x.get("score_risco", 0) or 0), reverse=True)
    linhas_tabela = [
        [post.get("data_post","")[:10], f"@{post.get('autor','')}",
         post.get("tema",""), str(int(post.get("score_risco",0) or 0)),
         post.get("urgencia",""), post.get("sugestao_acao","")[:20]]
        for post in dados_todos
    ]
    if linhas_tabela:
        t_todos = Table([["Data","Perfil","Tema","Score","Urgência","Ação"]] + linhas_tabela,
                        colWidths=[2.2*cm, 3.5*cm, 2.8*cm, 1.5*cm, 2*cm, 4.8*cm])
        t_todos.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1,0), COR_PRIMARIA),
            ("TEXTCOLOR",     (0,0), (-1,0), colors.white),
            ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",      (0,0), (-1,-1), 7),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [colors.white, COR_FUNDO]),
            ("GRID",          (0,0), (-1,-1), 0.3, COR_LINHA),
            ("TOPPADDING",    (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("LEFTPADDING",   (0,0), (-1,-1), 4),
        ]))
        story.append(t_todos)

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Radar Político Alagoinhas | {datetime.now().strftime('%d/%m/%Y %H:%M')} | Documento Confidencial",
        estilos["rodape"]))
    doc.build(story)
    buffer.seek(0)
    return buffer


# ═══════════════════════════════════════════════════════════════════════════════
#  WHATSAPP — ENVIO DE DOCUMENTO E ALERTA
# ═══════════════════════════════════════════════════════════════════════════════

def enviar_whatsapp_texto(mensagem):
    if not EVOLUTION_API_URL or not EVOLUTION_GROUP_ID:
        print("  WhatsApp não configurado — pulando.")
        return False
    try:
        url = f"{EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE}"
        headers = {"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"}
        payload = {"number": EVOLUTION_GROUP_ID, "text": mensagem}
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            print("  ✅ Mensagem WhatsApp enviada.")
            return True
        print(f"  ⚠️ Falha: {resp.status_code} — {resp.text[:100]}")
        return False
    except Exception as e:
        print(f"  ⚠️ Erro: {e}")
        return False


def enviar_whatsapp_documento(buffer_pdf, nome_arquivo, caption):
    """Envia PDF direto pelo WhatsApp via Evolution API (base64)."""
    if not EVOLUTION_API_URL or not EVOLUTION_GROUP_ID:
        print("  WhatsApp não configurado — pulando.")
        return False
    try:
        pdf_bytes  = buffer_pdf.read()
        pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
        url = f"{EVOLUTION_API_URL}/message/sendMedia/{EVOLUTION_INSTANCE}"
        headers = {"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"}
        payload = {
            "number":   EVOLUTION_GROUP_ID,
            "mediatype": "document",
            "mimetype":  "application/pdf",
            "caption":   caption,
            "media":     pdf_base64,
            "fileName":  nome_arquivo,
        }
        resp = requests.post(url, json=payload, headers=headers, timeout=60)
        if resp.status_code in (200, 201):
            print(f"  ✅ PDF enviado: {nome_arquivo}")
            return True
        print(f"  ⚠️ Falha envio PDF: {resp.status_code} — {resp.text[:200]}")
        return False
    except Exception as e:
        print(f"  ⚠️ Erro envio PDF: {e}")
        return False


def formatar_mensagem_alerta(stats, periodo):
    score_medio = stats.get("score_medio", 0)
    if score_medio >= 70:
        emoji_risco, nivel = "🔴", "ALTO"
    elif score_medio >= 40:
        emoji_risco, nivel = "🟠", "MÉDIO"
    else:
        emoji_risco, nivel = "🟢", "BAIXO"

    top1 = stats["top_posts"][0] if stats["top_posts"] else None
    linhas = [
        f"📊 *RELATÓRIO SEMANAL — RADAR POLÍTICO*",
        f"_Alagoinhas/BA | {periodo}_",
        f"",
        f"{emoji_risco} *Nível de Risco Geral: {nivel}*",
        f"Score médio da semana: {score_medio}/100",
        f"",
        f"📈 *Resumo da semana:*",
        f"• Posts analisados: {stats['total']}",
        f"• Positivo: {stats['positivos']} | Negativo: {stats['negativos']}",
        f"• Alto risco: {stats['alto_risco']} posts",
        f"• Tendência crescendo: {stats['crescendo']} posts",
        f"",
    ]
    if top1:
        score1 = int(top1.get("score_risco", 0) or 0)
        linhas += [
            f"🚨 *Post mais crítico da semana:*",
            f"@{top1.get('autor','')} | Score {score1}/100",
            f"{top1.get('resumo','')[:100]}",
            f"Ação: {top1.get('sugestao_acao','')}",
            f"",
        ]
    linhas += [
        f"📄 *Os relatórios PDF seguem abaixo:*",
        f"1️⃣ Resumo Executivo (visão geral)",
        f"2️⃣ Relatório Completo (análise detalhada)",
        f"",
        f"_Radar Político Alagoinhas — {datetime.now().strftime('%d/%m/%Y %H:%M')}_",
    ]
    return "\n".join(linhas)


# ═══════════════════════════════════════════════════════════════════════════════
#  PIPELINE PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

def gerar_e_enviar():
    print("=" * 65)
    print("RADAR POLÍTICO — Geração de Relatório Semanal")
    print(f"Execução: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print("=" * 65)

    hoje   = datetime.now()
    semana = hoje - timedelta(days=7)
    periodo = f"{semana.strftime('%d/%m/%Y')} a {hoje.strftime('%d/%m/%Y')}"

    print("\n[1/4] Conectando ao Google Sheets...")
    sh = conectar_sheets()

    print("\n[2/4] Carregando dados da semana...")
    dados = carregar_dados_semana(sh)
    print(f"  {len(dados)} posts encontrados no período.")
    if not dados:
        print("  Nenhum dado encontrado. Encerrando.")
        return
    stats = calcular_estatisticas(dados)
    print(f"  Score médio: {stats['score_medio']} | Alto risco: {stats['alto_risco']}")

    print("\n[3/4] Gerando PDFs...")
    nome_base     = f"Radar_Politico_Alagoinhas_{hoje.strftime('%Y-%m-%d')}"
    nome_resumo   = f"{nome_base}_Resumo_Executivo.pdf"
    nome_completo = f"{nome_base}_Relatorio_Completo.pdf"
    buf_resumo    = gerar_resumo_executivo(dados, stats, periodo)
    print("  ✅ Resumo executivo gerado.")
    buf_completo  = gerar_relatorio_completo(dados, stats, periodo)
    print("  ✅ Relatório completo gerado.")

    print("\n[4/4] Enviando pelo WhatsApp...")
    # 1. Mensagem de alerta com resumo
    mensagem = formatar_mensagem_alerta(stats, periodo)
    enviar_whatsapp_texto(mensagem)

    # 2. PDF resumo executivo
    enviar_whatsapp_documento(buf_resumo, nome_resumo, "📄 *Resumo Executivo* — visão geral da semana")

    # 3. PDF relatório completo
    enviar_whatsapp_documento(buf_completo, nome_completo, "📋 *Relatório Completo* — análise detalhada")

    print(f"\n{'='*65}")
    print("RELATÓRIO SEMANAL CONCLUÍDO — PDFs enviados pelo WhatsApp")
    print(f"{'='*65}")


if __name__ == "__main__":
    gerar_e_enviar()
