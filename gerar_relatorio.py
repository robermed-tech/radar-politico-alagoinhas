"""
RADAR POLÍTICO ALAGOINHAS — Relatório PDF Semanal
==================================================
Gera dois PDFs toda sexta às 18h BRT:
  - Resumo executivo (1-2 páginas)
  - Relatório completo (gráficos, tabelas, top posts, padrões)
Sobe ambos no Google Drive e envia alerta no WhatsApp com links.
"""

import os
import io
import json
import requests
import gspread
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics import renderPDF

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
COR_PRIMARIA   = colors.HexColor("#1a3a5c")   # Azul escuro
COR_SECUNDARIA = colors.HexColor("#2e7d32")   # Verde
COR_ALERTA     = colors.HexColor("#c62828")   # Vermelho
COR_AVISO      = colors.HexColor("#e65100")   # Laranja
COR_FUNDO      = colors.HexColor("#f5f5f5")   # Cinza claro
COR_LINHA      = colors.HexColor("#e0e0e0")   # Cinza linha


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE SHEETS — LEITURA DOS DADOS
# ═══════════════════════════════════════════════════════════════════════════════

def conectar_sheets():
    creds = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ],
    )
    gc = gspread.authorize(creds)
    return gc.open_by_key(GOOGLE_SHEET_ID), creds


def carregar_dados_semana(sh):
    """Carrega posts dos últimos 7 dias do Sheets."""
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
    """Calcula estatísticas agregadas da semana."""
    if not dados:
        return {}

    total = len(dados)
    positivos  = sum(1 for r in dados if str(r.get("sentimento_post","")).lower() == "positivo")
    negativos  = sum(1 for r in dados if str(r.get("sentimento_post","")).lower() == "negativo")
    neutros    = total - positivos - negativos
    alto_risco = sum(1 for r in dados if str(r.get("risco_crise","")).lower() == "alto")
    medio_risco = sum(1 for r in dados if str(r.get("risco_crise","")).lower() == "médio")
    crescendo  = sum(1 for r in dados if str(r.get("tendencia","")).lower() == "crescendo")

    # Score médio
    scores = [int(r.get("score_risco", 0) or 0) for r in dados]
    score_medio = sum(scores) // len(scores) if scores else 0
    score_max   = max(scores) if scores else 0

    # Por categoria
    por_categoria = {}
    for r in dados:
        cat = r.get("categoria_perfil", "Outro")
        por_categoria[cat] = por_categoria.get(cat, 0) + 1

    # Por tema
    por_tema = {}
    for r in dados:
        tema = r.get("tema", "Outro")
        por_tema[tema] = por_tema.get(tema, 0) + 1
    top_temas = sorted(por_tema.items(), key=lambda x: x[1], reverse=True)[:5]

    # Top posts por score
    top_posts = sorted(dados, key=lambda x: int(x.get("score_risco", 0) or 0), reverse=True)[:5]

    # Perfis mais ativos
    por_perfil = {}
    for r in dados:
        autor = r.get("autor", "")
        por_perfil[autor] = por_perfil.get(autor, 0) + 1
    top_perfis = sorted(por_perfil.items(), key=lambda x: x[1], reverse=True)[:5]

    # Ações recomendadas
    por_acao = {}
    for r in dados:
        acao = r.get("sugestao_acao", "Monitorar")
        por_acao[acao] = por_acao.get(acao, 0) + 1

    # Total de curtidas e comentários
    total_curtidas     = sum(int(r.get("curtidas", 0) or 0) for r in dados)
    total_comentarios  = sum(int(r.get("comentarios_count", 0) or 0) for r in dados)

    return {
        "total": total,
        "positivos": positivos,
        "negativos": negativos,
        "neutros": neutros,
        "alto_risco": alto_risco,
        "medio_risco": medio_risco,
        "crescendo": crescendo,
        "score_medio": score_medio,
        "score_max": score_max,
        "por_categoria": por_categoria,
        "top_temas": top_temas,
        "top_posts": top_posts,
        "top_perfis": top_perfis,
        "por_acao": por_acao,
        "total_curtidas": total_curtidas,
        "total_comentarios": total_comentarios,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  ESTILOS COMPARTILHADOS
# ═══════════════════════════════════════════════════════════════════════════════

def criar_estilos():
    base = getSampleStyleSheet()
    estilos = {
        "titulo_doc": ParagraphStyle(
            "titulo_doc",
            parent=base["Title"],
            fontSize=22,
            textColor=COR_PRIMARIA,
            spaceAfter=6,
            alignment=TA_CENTER,
            fontName="Helvetica-Bold",
        ),
        "subtitulo": ParagraphStyle(
            "subtitulo",
            parent=base["Normal"],
            fontSize=11,
            textColor=colors.HexColor("#555555"),
            spaceAfter=20,
            alignment=TA_CENTER,
        ),
        "secao": ParagraphStyle(
            "secao",
            parent=base["Heading1"],
            fontSize=13,
            textColor=COR_PRIMARIA,
            spaceBefore=16,
            spaceAfter=8,
            fontName="Helvetica-Bold",
            borderPad=4,
        ),
        "normal": ParagraphStyle(
            "normal",
            parent=base["Normal"],
            fontSize=9,
            leading=14,
            spaceAfter=4,
        ),
        "normal_bold": ParagraphStyle(
            "normal_bold",
            parent=base["Normal"],
            fontSize=9,
            leading=14,
            fontName="Helvetica-Bold",
        ),
        "alerta": ParagraphStyle(
            "alerta",
            parent=base["Normal"],
            fontSize=9,
            textColor=COR_ALERTA,
            fontName="Helvetica-Bold",
        ),
        "rodape": ParagraphStyle(
            "rodape",
            parent=base["Normal"],
            fontSize=7,
            textColor=colors.grey,
            alignment=TA_CENTER,
        ),
        "card_titulo": ParagraphStyle(
            "card_titulo",
            parent=base["Normal"],
            fontSize=10,
            fontName="Helvetica-Bold",
            textColor=COR_PRIMARIA,
        ),
        "card_body": ParagraphStyle(
            "card_body",
            parent=base["Normal"],
            fontSize=8,
            leading=12,
        ),
    }
    return estilos


def tabela_padrao(dados, cabecalho, col_widths=None):
    """Cria tabela com estilo padrão do relatório."""
    table_data = [cabecalho] + dados
    t = Table(table_data, colWidths=col_widths)
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
    """Retorna cor baseada no score."""
    if score >= 70:
        return COR_ALERTA
    elif score >= 40:
        return COR_AVISO
    return COR_SECUNDARIA


# ═══════════════════════════════════════════════════════════════════════════════
#  RESUMO EXECUTIVO (1-2 páginas)
# ═══════════════════════════════════════════════════════════════════════════════

def gerar_resumo_executivo(dados, stats, periodo):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm
    )
    estilos = criar_estilos()
    story = []

    # Cabeçalho
    story.append(Paragraph("RADAR POLÍTICO ALAGOINHAS", estilos["titulo_doc"]))
    story.append(Paragraph("Resumo Executivo Semanal", estilos["subtitulo"]))
    story.append(Paragraph(f"Período: {periodo}", estilos["subtitulo"]))
    story.append(HRFlowable(width="100%", thickness=2, color=COR_PRIMARIA))
    story.append(Spacer(1, 12))

    # Cards de métricas principais
    story.append(Paragraph("VISÃO GERAL DA SEMANA", estilos["secao"]))

    pct_neg = round(stats["negativos"] / stats["total"] * 100) if stats["total"] else 0
    pct_pos = round(stats["positivos"] / stats["total"] * 100) if stats["total"] else 0

    metricas = [
        ["📊 Posts Analisados", "😊 Sentimento Positivo", "😠 Sentimento Negativo", "🚨 Alto Risco"],
        [
            str(stats["total"]),
            f"{stats['positivos']} ({pct_pos}%)",
            f"{stats['negativos']} ({pct_neg}%)",
            str(stats["alto_risco"]),
        ]
    ]
    t_metricas = Table(metricas, colWidths=[4.2*cm, 4.2*cm, 4.2*cm, 4.2*cm])
    t_metricas.setStyle(TableStyle([
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
        ("ROUNDEDCORNERS", [4]),
    ]))
    story.append(t_metricas)
    story.append(Spacer(1, 16))

    # Score e engajamento
    metricas2 = [
        ["📈 Score Médio de Risco", "🔝 Score Máximo", "❤️ Total Curtidas", "💬 Total Comentários"],
        [
            f"{stats['score_medio']}/100",
            f"{stats['score_max']}/100",
            f"{stats['total_curtidas']:,}".replace(",", "."),
            f"{stats['total_comentarios']:,}".replace(",", "."),
        ]
    ]
    t_metricas2 = Table(metricas2, colWidths=[4.2*cm, 4.2*cm, 4.2*cm, 4.2*cm])
    t_metricas2.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), colors.HexColor("#37474f")),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 8),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("FONTNAME",      (0, 1), (-1, 1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 1), (-1, 1), 16),
        ("BACKGROUND",    (0, 1), (-1, 1), COR_FUNDO),
        ("GRID",          (0, 0), (-1, -1), 0.5, COR_LINHA),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t_metricas2)
    story.append(Spacer(1, 16))

    # Top 3 alertas da semana
    story.append(Paragraph("TOP 3 ALERTAS DA SEMANA", estilos["secao"]))
    top3 = stats["top_posts"][:3]
    if top3:
        for i, post in enumerate(top3, 1):
            score = int(post.get("score_risco", 0) or 0)
            cor_score = barra_score(score)
            emoji = "🔴" if score >= 70 else "🟠" if score >= 40 else "🟢"
            dados_card = [
                [
                    Paragraph(f"{emoji} {i}. @{post.get('autor','')} — {post.get('tema','')}", estilos["card_titulo"]),
                    Paragraph(f"Score: {score}/100", ParagraphStyle("sc", fontSize=11, fontName="Helvetica-Bold", textColor=cor_score, alignment=TA_RIGHT)),
                ],
                [
                    Paragraph(post.get("resumo", "")[:120], estilos["card_body"]),
                    Paragraph(f"Ação: {post.get('sugestao_acao','')}", estilos["card_body"]),
                ],
            ]
            t_card = Table(dados_card, colWidths=[12*cm, 4.8*cm])
            t_card.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), COR_FUNDO),
                ("GRID",          (0, 0), (-1, -1), 0.5, COR_LINHA),
                ("TOPPADDING",    (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING",   (0, 0), (-1, -1), 8),
                ("SPAN",          (0, 0), (0, 0)),
                ("LINEBELOW",     (0, 0), (-1, 0), 1, COR_LINHA),
            ]))
            story.append(t_card)
            story.append(Spacer(1, 6))

    story.append(Spacer(1, 12))

    # Temas dominantes
    story.append(Paragraph("TEMAS DOMINANTES", estilos["secao"]))
    if stats["top_temas"]:
        dados_temas = [[tema, str(count), f"{round(count/stats['total']*100)}%"]
                       for tema, count in stats["top_temas"]]
        story.append(tabela_padrao(
            dados_temas,
            ["Tema", "Posts", "% do Total"],
            col_widths=[10*cm, 3*cm, 3.8*cm]
        ))

    story.append(Spacer(1, 12))

    # Ações recomendadas
    story.append(Paragraph("AÇÕES RECOMENDADAS NA SEMANA", estilos["secao"]))
    if stats["por_acao"]:
        dados_acoes = sorted(stats["por_acao"].items(), key=lambda x: x[1], reverse=True)
        dados_acoes_fmt = [[acao, str(count)] for acao, count in dados_acoes]
        story.append(tabela_padrao(
            dados_acoes_fmt,
            ["Ação Recomendada", "Qtd Posts"],
            col_widths=[13*cm, 3.8*cm]
        ))

    # Rodapé
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Radar Político Alagoinhas | Gerado em {datetime.now().strftime('%d/%m/%Y às %H:%M')} | Confidencial",
        estilos["rodape"]
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer


# ═══════════════════════════════════════════════════════════════════════════════
#  RELATÓRIO COMPLETO
# ═══════════════════════════════════════════════════════════════════════════════

def gerar_relatorio_completo(dados, stats, periodo):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm
    )
    estilos = criar_estilos()
    story = []

    # ── Capa ─────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 3*cm))
    story.append(Paragraph("RADAR POLÍTICO", estilos["titulo_doc"]))
    story.append(Paragraph("ALAGOINHAS / BA", ParagraphStyle(
        "cidade", fontSize=16, textColor=COR_SECUNDARIA,
        alignment=TA_CENTER, fontName="Helvetica-Bold", spaceAfter=8
    )))
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="60%", thickness=3, color=COR_PRIMARIA, hAlign="CENTER"))
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Relatório Semanal Completo", estilos["subtitulo"]))
    story.append(Paragraph(f"Período: {periodo}", estilos["subtitulo"]))
    story.append(Paragraph(
        f"Gerado em: {datetime.now().strftime('%d/%m/%Y às %H:%M')}",
        estilos["subtitulo"]
    ))
    story.append(Spacer(1, 2*cm))

    # Indicador de risco geral
    score_medio = stats.get("score_medio", 0)
    if score_medio >= 70:
        nivel_risco = "ALTO"
        cor_nivel   = COR_ALERTA
    elif score_medio >= 40:
        nivel_risco = "MÉDIO"
        cor_nivel   = COR_AVISO
    else:
        nivel_risco = "BAIXO"
        cor_nivel   = COR_SECUNDARIA

    dados_nivel = [[
        Paragraph(f"NÍVEL DE RISCO GERAL DA SEMANA: {nivel_risco}", ParagraphStyle(
            "nivel", fontSize=14, fontName="Helvetica-Bold",
            textColor=colors.white, alignment=TA_CENTER
        ))
    ]]
    t_nivel = Table(dados_nivel, colWidths=[16.8*cm])
    t_nivel.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), cor_nivel),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(t_nivel)
    story.append(PageBreak())

    # ── Seção 1: Estatísticas gerais ─────────────────────────────────────────
    story.append(Paragraph("1. ESTATÍSTICAS GERAIS DA SEMANA", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    pct_neg = round(stats["negativos"] / stats["total"] * 100) if stats["total"] else 0
    pct_pos = round(stats["positivos"] / stats["total"] * 100) if stats["total"] else 0
    pct_neu = 100 - pct_neg - pct_pos

    dados_geral = [
        ["Métrica", "Valor", "Observação"],
        ["Total de posts analisados", str(stats["total"]), "Todos os perfis monitorados"],
        ["Sentimento positivo", f"{stats['positivos']} ({pct_pos}%)", "Posts favoráveis à gestão"],
        ["Sentimento negativo", f"{stats['negativos']} ({pct_neg}%)", "Posts críticos ou de risco"],
        ["Sentimento neutro", f"{stats['neutros']} ({pct_neu}%)", "Informativos / sem posição clara"],
        ["Alto risco", str(stats["alto_risco"]), "Requerem ação imediata"],
        ["Risco médio", str(stats["medio_risco"]), "Requerem monitoramento ativo"],
        ["Tendência crescendo", str(stats["crescendo"]), "Posts com engajamento em alta"],
        ["Score médio de risco", f"{stats['score_medio']}/100", "Média ponderada da semana"],
        ["Score máximo registrado", f"{stats['score_max']}/100", "Post mais crítico da semana"],
        ["Total de curtidas", f"{stats['total_curtidas']:,}".replace(",","."), "Engajamento total"],
        ["Total de comentários", f"{stats['total_comentarios']:,}".replace(",","."), "Interações totais"],
    ]
    story.append(tabela_padrao(
        dados_geral[1:], dados_geral[0],
        col_widths=[7*cm, 4*cm, 5.8*cm]
    ))
    story.append(Spacer(1, 16))

    # ── Seção 2: Por categoria de perfil ─────────────────────────────────────
    story.append(Paragraph("2. POSTS POR CATEGORIA DE PERFIL", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    if stats["por_categoria"]:
        dados_cat = [
            [cat, str(count), f"{round(count/stats['total']*100)}%"]
            for cat, count in sorted(stats["por_categoria"].items(), key=lambda x: x[1], reverse=True)
        ]
        story.append(tabela_padrao(
            dados_cat, ["Categoria", "Posts", "% do Total"],
            col_widths=[8*cm, 4*cm, 4.8*cm]
        ))
    story.append(Spacer(1, 16))

    # ── Seção 3: Temas dominantes ─────────────────────────────────────────────
    story.append(Paragraph("3. TEMAS DOMINANTES NA SEMANA", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    if stats["top_temas"]:
        dados_temas = [
            [tema, str(count), f"{round(count/stats['total']*100)}%"]
            for tema, count in stats["top_temas"]
        ]
        story.append(tabela_padrao(
            dados_temas, ["Tema", "Posts", "% do Total"],
            col_widths=[8*cm, 4*cm, 4.8*cm]
        ))
    story.append(Spacer(1, 16))

    # ── Seção 4: Perfis mais ativos ───────────────────────────────────────────
    story.append(Paragraph("4. PERFIS MAIS ATIVOS", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    if stats["top_perfis"]:
        dados_perfis = [
            [f"@{perfil}", str(count), ""]
            for perfil, count in stats["top_perfis"]
        ]
        story.append(tabela_padrao(
            dados_perfis, ["Perfil", "Posts na Semana", "Observação"],
            col_widths=[7*cm, 4*cm, 5.8*cm]
        ))
    story.append(Spacer(1, 16))

    # ── Seção 5: Top 5 posts críticos ────────────────────────────────────────
    story.append(Paragraph("5. TOP 5 POSTS POR SCORE DE RISCO", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    for i, post in enumerate(stats["top_posts"], 1):
        score    = int(post.get("score_risco", 0) or 0)
        cor_s    = barra_score(score)
        emoji    = "🔴" if score >= 70 else "🟠" if score >= 40 else "🟢"
        categoria = post.get("categoria_perfil", "")
        padrao   = post.get("padrao_detectado", "Isolado")

        cabecalho_card = [
            Paragraph(f"{emoji} #{i} — @{post.get('autor','')} ({categoria})", estilos["card_titulo"]),
            Paragraph(f"Score: {score}/100", ParagraphStyle(
                "sc2", fontSize=12, fontName="Helvetica-Bold",
                textColor=cor_s, alignment=TA_RIGHT
            )),
        ]
        corpo_card = [
            [
                Paragraph(f"<b>Tema:</b> {post.get('tema','')} | <b>Urgência:</b> {post.get('urgencia','')} | <b>Risco:</b> {post.get('risco_crise','')}", estilos["card_body"]),
                Paragraph(f"<b>Data:</b> {post.get('data_post','')}", estilos["card_body"]),
            ],
            [
                Paragraph(f"<b>Resumo:</b> {post.get('resumo','')}", estilos["card_body"]),
                Paragraph(f"<b>Ação:</b> {post.get('sugestao_acao','')}", estilos["card_body"]),
            ],
        ]
        if padrao and padrao != "Isolado":
            corpo_card.append([
                Paragraph(f"<b>Padrão detectado:</b> {padrao}", estilos["alerta"]),
                Paragraph("", estilos["card_body"]),
            ])

        t_cab = Table([cabecalho_card], colWidths=[12*cm, 4.8*cm])
        t_cab.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), COR_PRIMARIA),
            ("TEXTCOLOR",  (0, 0), (-1, -1), colors.white),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(t_cab)

        t_corpo = Table(corpo_card, colWidths=[12*cm, 4.8*cm])
        t_corpo.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), COR_FUNDO),
            ("GRID",       (0, 0), (-1, -1), 0.5, COR_LINHA),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(t_corpo)
        story.append(Spacer(1, 10))

    # ── Seção 6: Ações recomendadas ───────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("6. DISTRIBUIÇÃO DE AÇÕES RECOMENDADAS", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    if stats["por_acao"]:
        dados_acoes = sorted(stats["por_acao"].items(), key=lambda x: x[1], reverse=True)
        dados_acoes_fmt = [
            [acao, str(count), f"{round(count/stats['total']*100)}%"]
            for acao, count in dados_acoes
        ]
        story.append(tabela_padrao(
            dados_acoes_fmt, ["Ação Recomendada", "Posts", "% do Total"],
            col_widths=[9*cm, 3*cm, 4.8*cm]
        ))
    story.append(Spacer(1, 16))

    # ── Seção 7: Todos os posts da semana ────────────────────────────────────
    story.append(Paragraph("7. TODOS OS POSTS ANALISADOS NA SEMANA", estilos["secao"]))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 8))

    dados_todos = sorted(dados, key=lambda x: int(x.get("score_risco", 0) or 0), reverse=True)
    linhas_tabela = [
        [
            post.get("data_post", "")[:10],
            f"@{post.get('autor','')}",
            post.get("tema", ""),
            str(int(post.get("score_risco", 0) or 0)),
            post.get("urgencia", ""),
            post.get("sugestao_acao", "")[:20],
        ]
        for post in dados_todos
    ]
    if linhas_tabela:
        t_todos = Table(
            [["Data", "Perfil", "Tema", "Score", "Urgência", "Ação"]] + linhas_tabela,
            colWidths=[2.2*cm, 3.5*cm, 2.8*cm, 1.5*cm, 2*cm, 4.8*cm]
        )
        t_todos.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0), COR_PRIMARIA),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 7),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, COR_FUNDO]),
            ("GRID",          (0, 0), (-1, -1), 0.3, COR_LINHA),
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ]))
        story.append(t_todos)

    # ── Rodapé ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_LINHA))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Radar Político Alagoinhas | Gerado em {datetime.now().strftime('%d/%m/%Y às %H:%M')} | Documento Confidencial — Uso Interno",
        estilos["rodape"]
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE DRIVE — UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════

def upload_drive(creds, buffer, nome_arquivo, folder_id=None):
    """Sobe o PDF no Google Drive e retorna o link público."""
    service = build("drive", "v3", credentials=creds)

    file_metadata = {"name": nome_arquivo}
    if folder_id:
        file_metadata["parents"] = [folder_id]

    media = MediaIoBaseUpload(buffer, mimetype="application/pdf", resumable=True)

    # supportsAllDrives=True permite upload em pastas compartilhadas (Shared Drives)
    arquivo = service.files().create(
        body=file_metadata,
        media_body=media,
        fields="id, webViewLink",
        supportsAllDrives=True,
    ).execute()

    file_id = arquivo.get("id")

    # Torna o arquivo público (qualquer um com o link pode visualizar)
    service.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
    ).execute()

    link = arquivo.get("webViewLink", f"https://drive.google.com/file/d/{file_id}/view")
    print(f"  ✅ Upload concluído: {nome_arquivo} → {link}")
    return link


# ═══════════════════════════════════════════════════════════════════════════════
#  WHATSAPP — ALERTA COM LINKS
# ═══════════════════════════════════════════════════════════════════════════════

def enviar_whatsapp(mensagem):
    if not EVOLUTION_API_URL or not EVOLUTION_GROUP_ID:
        print("  WhatsApp não configurado — pulando.")
        return False
    try:
        url = f"{EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE}"
        headers = {"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"}
        payload = {"number": EVOLUTION_GROUP_ID, "text": mensagem}
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            print("  ✅ WhatsApp enviado.")
            return True
        print(f"  ⚠️ Falha WhatsApp: {resp.status_code}")
        return False
    except Exception as e:
        print(f"  ⚠️ Erro WhatsApp: {e}")
        return False


def formatar_mensagem_whatsapp(stats, link_resumo, link_completo, periodo):
    score_medio = stats.get("score_medio", 0)
    if score_medio >= 70:
        emoji_risco = "🔴"
        nivel = "ALTO"
    elif score_medio >= 40:
        emoji_risco = "🟠"
        nivel = "MÉDIO"
    else:
        emoji_risco = "🟢"
        nivel = "BAIXO"

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
        f"• Sentimento positivo: {stats['positivos']} | Negativo: {stats['negativos']}",
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
        f"📄 *Relatórios disponíveis:*",
        f"",
        f"*Resumo Executivo (1-2 págs):*",
        f"{link_resumo}",
        f"",
        f"*Relatório Completo:*",
        f"{link_completo}",
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

    # Período do relatório
    hoje    = datetime.now()
    semana  = hoje - timedelta(days=7)
    periodo = f"{semana.strftime('%d/%m/%Y')} a {hoje.strftime('%d/%m/%Y')}"

    # Conecta ao Sheets
    print("\n[1/5] Conectando ao Google Sheets...")
    sh, creds = conectar_sheets()

    # Carrega dados
    print("\n[2/5] Carregando dados da semana...")
    dados = carregar_dados_semana(sh)
    print(f"  {len(dados)} posts encontrados no período.")

    if not dados:
        print("  Nenhum dado encontrado. Encerrando.")
        return

    stats = calcular_estatisticas(dados)
    print(f"  Score médio: {stats['score_medio']} | Alto risco: {stats['alto_risco']}")

    # Gera PDFs
    print("\n[3/5] Gerando PDFs...")
    nome_base    = f"Radar_Politico_Alagoinhas_{hoje.strftime('%Y-%m-%d')}"
    nome_resumo  = f"{nome_base}_Resumo_Executivo.pdf"
    nome_completo = f"{nome_base}_Relatorio_Completo.pdf"

    buf_resumo   = gerar_resumo_executivo(dados, stats, periodo)
    print(f"  ✅ Resumo executivo gerado.")
    buf_completo = gerar_relatorio_completo(dados, stats, periodo)
    print(f"  ✅ Relatório completo gerado.")

    # Sobe no Drive
    print("\n[4/5] Subindo para o Google Drive...")
    # Opcional: passe o ID de uma pasta específica no Drive
    DRIVE_FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID", None)
    link_resumo   = upload_drive(creds, buf_resumo,   nome_resumo,   DRIVE_FOLDER_ID)
    link_completo = upload_drive(creds, buf_completo, nome_completo, DRIVE_FOLDER_ID)

    # Envia WhatsApp
    print("\n[5/5] Enviando alerta no WhatsApp...")
    mensagem = formatar_mensagem_whatsapp(stats, link_resumo, link_completo, periodo)
    enviar_whatsapp(mensagem)

    print(f"\n{'='*65}")
    print("RELATÓRIO SEMANAL CONCLUÍDO")
    print(f"  Resumo:   {link_resumo}")
    print(f"  Completo: {link_completo}")
    print(f"{'='*65}")


if __name__ == "__main__":
    gerar_e_enviar()
