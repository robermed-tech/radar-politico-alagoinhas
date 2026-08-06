# -*- coding: utf-8 -*-
"""Acentuação determinística dos briefings gravados sem acento (06/08/26).

O reparo via modelo (`agora.py --reparar-acentos-briefings`) depende da API
Anthropic, que está sem crédito ("credit balance is too low", issue
reparo-acentos). Este script não depende de modelo nenhum: aplica um mapa de
correções DERIVADO DO CORPUS REAL das 8 linhas sem acento — cada n-grama e
cada palavra do dicionário foi conferido ocorrência por ocorrência (inclusive
os ambíguos: "critica" verbo fica sem acento, "esta semana" fica pronome,
crase só onde a regência pede).

Salvaguardas:
- Só toca linha cujo diagnóstico longo não tem NENHUM acento (o mesmo critério
  da sonda de diagnóstico) — as demais linhas nem são lidas pelo mapa, porque
  os ambíguos foram validados apenas neste corpus. Idempotente: linha reparada
  sai do critério.
- Depois do mapa, o texto normalizado (NFD sem marcas de combinação) tem que
  ser IDÊNTICO ao de antes — qualquer mudança além de diacríticos aborta a
  linha. As três exceções de grafia (lista CORRECOES_EXATAS) rodam antes e são
  substituições literais fechadas.

Uso:
  python acentuar_briefings.py                  # aplica no Supabase (env)
  python acentuar_briefings.py --dry-run        # mostra sem gravar
  python acentuar_briefings.py --local arq.json # aplica num dump local e
                                                # imprime o resultado (teste)
"""
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

# Erros de grafia reais (não são só diacríticos): substituição literal.
CORRECOES_EXATAS = [
    ("Empatetico e resolutivo", "Empático e resolutivo"),
    ("empaticocom os pacientes", "empático com os pacientes"),
    ("sem juridiquese.", "sem juridiquês."),
]

# N-gramas para os casos que um dicionário cego erraria. A ENTRADA é o texto
# cru (sem acento) e a SAÍDA já vem acentuada por completo — por isso rodam
# ANTES do dicionário. Conferidos um a um contra o corpus.
NGRAMAS = [
    # "e" que é verbo ser
    ("na amostra e alta", "na amostra é alta"),
    ("ambiente digital e o risco de fechamento", "ambiente digital é o risco de fechamento"),
    ("saldo de sentimento e negativo", "saldo de sentimento é negativo"),
    ("O objetivo e quebrar", "O objetivo é quebrar"),
    ("institucional e apontada", "institucional é apontada"),
    ("A queixa e concreta", "A queixa é concreta"),
    ("ainda e controlavel", "ainda é controlável"),
    ("dominante e de abandono e descaso", "dominante é de abandono e descaso"),
    ("o que e positivo", "o que é positivo"),
    ("redes e um ponto", "redes é um ponto"),
    ("quem e responsavel", "quem é responsável"),
    ("do periodo e critica, com proporcao", "do período é crítica, com proporção"),
    ("saldo geral e negativo", "saldo geral é negativo"),
    ("volume de manifestacoes cidadas e saude", "volume de manifestações cidadãs é saúde"),
    # "esta" que é verbo estar ("esta semana" pronome fica de fora)
    ("esta tomando", "está tomando"),
    ("esta gerando", "está gerando"),
    ("esta resolvendo", "está resolvendo"),
    ("esta sendo", "está sendo"),
    ("esta funcionando", "está funcionando"),
    ("esta acontecendo", "está acontecendo"),
    ("esta em risco", "está em risco"),
    ("esta fragilizada", "está fragilizada"),
    ("esta praticamente vazio", "está praticamente vazio"),
    # "critica" substantivo/adjetivo (os DOIS verbos do corpus, "do periodo
    # critica a gestao" e "critica a administracao", ficam sem acento)
    ("carrega critica", "carrega crítica"),
    ("parcela critica supera", "parcela crítica supera"),
    ("periodo foi critica", "período foi crítica"),
    ("para critica, exige", "para crítica, exige"),
    ("deslocando a critica", "deslocando a crítica"),
    ("movem a critica", "movem a crítica"),
    ("com a critica dominante", "com a crítica dominante"),
    ("imprensa critica", "imprensa crítica"),
    # Crase (só onde a regência tem artigo definido feminino)
    ("se referem a gestao municipal", "se referem à gestão municipal"),
    ("direcionados a gestao atual", "direcionados à gestão atual"),
    ("criticas diretas a gestao", "críticas diretas à gestão"),
    ("diretamente a narrativa de fechamento", "diretamente à narrativa de fechamento"),
    ("associada a narrativa de abandono", "associada à narrativa de abandono"),
    ("ponto a ponto as criticas", "ponto a ponto às críticas"),
    ("linguagem simples as duvidas", "linguagem simples às dúvidas"),
    ("competente a entrada de Alagoinhas e a rodoviaria",
     "competente à entrada de Alagoinhas e à rodoviária"),
    ("proximos a propria prefeitura", "próximos à própria prefeitura"),
    ("exclusivo a cobertura", "exclusivo à cobertura"),
    ("hoje a noite", "hoje à noite"),
]

# Palavras inequívocas NESTE corpus (cada ambígua da língua foi conferida:
# "publica"/"politica"/"especifica" só aparecem como adjetivo, "ha" só como
# verbo, "anuncio"/"silencio"/"divida"/"evidencia" só como substantivo).
DICIONARIO = {
    "acao": "ação", "acessivel": "acessível", "acoes": "ações",
    "acusacao": "acusação", "administracao": "administração",
    "adversaria": "adversária",
    "alimentacao": "alimentação", "alocacao": "alocação", "amanha": "amanhã",
    "ameaca": "ameaça", "anuncio": "anúncio", "apos": "após",
    "aprovacao": "aprovação", "area": "área", "associacao": "associação",
    "ate": "até", "atualizacao": "atualização", "ausencia": "ausência",
    "autonomos": "autônomos", "autoritaria": "autoritária",
    "avancos": "avanços", "beneficio": "benefício", "biao": "bião",
    "burocratica": "burocrática", "camara": "câmara", "camera": "câmera",
    "cidada": "cidadã", "cidadao": "cidadão", "cidadaos": "cidadãos",
    "cidadas": "cidadãs", "cirurgica": "cirúrgica", "cirurgicas": "cirúrgicas",
    "cobranca": "cobrança", "combustivel": "combustível",
    "comecar": "começar", "comercio": "comércio",
    "comentario": "comentário", "comentarios": "comentários",
    "comparacao": "comparação", "competencia": "competência",
    "comunicacao": "comunicação", "comunitarias": "comunitárias",
    "comunitarios": "comunitários", "concluidas": "concluídas",
    "conclusao": "conclusão", "confianca": "confiança",
    "conteudo": "conteúdo",
    "confirmacao": "confirmação", "contrabalanco": "contrabalanço",
    "contradicao": "contradição", "contratacao": "contratação",
    "controlavel": "controlável", "cooperacao": "cooperação",
    "criterios": "critérios", "critico": "crítico", "criticos": "críticos",
    "criticas": "críticas", "declaracao": "declaração",
    "deficiencia": "deficiência", "denuncias": "denúncias",
    "desconfianca": "desconfiança", "descrenca": "descrença",
    "dialogo": "diálogo",
    "direcao": "direção", "disponiveis": "disponíveis",
    "distribuidas": "distribuídas", "divida": "dívida",
    "divulgacao": "divulgação", "duvidas": "dúvidas",
    "economico": "econômico", "educacao": "educação", "endereco": "endereço",
    "espaco": "espaço", "espacos": "espaços", "especifica": "específica",
    "espontaneos": "espontâneos", "estao": "estão", "evidencia": "evidência",
    "execucao": "execução", "explicacao": "explicação",
    "familias": "famílias", "favoravel": "favorável", "fisica": "física",
    "fiscalizacao": "fiscalização", "frequencia": "frequência",
    "generico": "genérico", "genericos": "genéricos", "gestao": "gestão",
    "gestoes": "gestões", "ha": "há", "identificavel": "identificável",
    "inclusao": "inclusão", "informacao": "informação",
    "insatisfacoes": "insatisfações", "interacoes": "interações",
    "interrupcao": "interrupção", "intervencao": "intervenção", "ja": "já",
    "jargao": "jargão", "lancamento": "lançamento", "lancar": "lançar",
    "legitima": "legítima",
    "licencas": "licenças", "liderancas": "lideranças",
    "manifestacoes": "manifestações", "manutencao": "manutenção",
    "matriculas": "matrículas", "medicos": "médicos",
    "mensuravel": "mensurável", "mes": "mês", "midia": "mídia",
    "minima": "mínima", "mudancas": "mudanças", "municipio": "município",
    "nao": "não", "numero": "número", "omissao": "omissão",
    "opiniao": "opinião", "oposicao": "oposição",
    "orcamentario": "orçamentário", "organizacao": "organização",
    "pagina": "página", "pendencia": "pendência", "percepcao": "percepção",
    "periodo": "período", "periodos": "períodos", "politica": "política",
    "politico": "político", "populacao": "população", "porem": "porém",
    "posicao": "posição", "possivel": "possível", "precario": "precário",
    "premio": "prêmio", "preocupacao": "preocupação", "presenca": "presença",
    "prestacao": "prestação", "previsao": "previsão", "producao": "produção",
    "proporcao": "proporção", "propria": "própria", "proprio": "próprio",
    "proprios": "próprios", "providencia": "providência",
    "providencias": "providências", "proximas": "próximas",
    "proximo": "próximo", "proximos": "próximos", "publica": "pública",
    "publicacao": "publicação", "publicacoes": "publicações",
    "publico": "público", "publicos": "públicos",
    "qualificacao": "qualificação", "rapida": "rápida", "rapido": "rápido",
    "realizacoes": "realizações", "reducao": "redução",
    "regularizacao": "regularização", "responsavel": "responsável",
    "reuniao": "reunião", "reunioes": "reuniões", "rodoviaria": "rodoviária",
    "sao": "são", "saude": "saúde", "secretario": "secretário",
    "sensiveis": "sensíveis",
    "sequencia": "sequência", "serie": "série", "servico": "serviço",
    "servicos": "serviços", "silencio": "silêncio", "simbolica": "simbólica",
    "simbolos": "símbolos", "situacao": "situação", "solucao": "solução",
    "sugestoes": "sugestões", "tecnica": "técnica", "tecnico": "técnico",
    "tensao": "tensão", "transparencia": "transparência", "tres": "três",
    "uteis": "úteis", "veiculos": "veículos",
    "verificavel": "verificável", "verificaveis": "verificáveis",
    "versao": "versão", "video": "vídeo",
    "videos": "vídeos", "visiveis": "visíveis", "visivel": "visível",
    "vitimizacao": "vitimização",
}

CAMPOS_LIVRES = {
    "alertas": ("tema",),
    "oportunidades": ("titulo", "acao"),
    "recomendacoes": ("canal", "mensagem", "tom", "timing"),
}

_ACENTOS = "áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ"
_PALAVRA = re.compile(r"[A-Za-z]+")


def _sem_diacriticos(texto):
    nfd = unicodedata.normalize("NFD", texto or "")
    return "".join(ch for ch in nfd if not unicodedata.combining(ch))


def _troca_palavra(m):
    p = m.group(0)
    corr = DICIONARIO.get(p.lower())
    if not corr:
        return p
    if p[0].isupper():
        corr = corr[0].upper() + corr[1:]
    return corr


def acentuar(texto):
    """Aplica exatas -> n-gramas -> dicionário e valida NFD. Devolve o texto
    corrigido, ou o original se a validação reprovar."""
    base = texto
    for antes, depois in CORRECOES_EXATAS:
        base = base.replace(antes, depois)
    novo = base
    for antes, depois in NGRAMAS:
        novo = novo.replace(antes, depois)
    novo = _PALAVRA.sub(_troca_palavra, novo)
    if _sem_diacriticos(novo) != _sem_diacriticos(base):
        print(f"  !! validador NFD reprovou, texto mantido: {texto[:80]}…")
        return texto
    return novo


def linha_alvo(row):
    d = row.get("diagnostico") or ""
    return len(d) > 120 and not any(ch in _ACENTOS for ch in d)


def corrigir_linha(row):
    novo = {"diagnostico": acentuar(row.get("diagnostico") or "")}
    for lista, campos in CAMPOS_LIVRES.items():
        itens = []
        for item in row.get(lista) or []:
            item = dict(item or {})
            for campo in campos:
                v = item.get(campo)
                if isinstance(v, str) and v.strip():
                    item[campo] = acentuar(v)
            itens.append(item)
        novo[lista] = itens
    return novo


def _http(url, headers, data=None, method="GET"):
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main():
    if "--local" in sys.argv:
        arq = sys.argv[sys.argv.index("--local") + 1]
        rows = json.load(open(arq))
        for row in rows:
            print("=====", row.get("periodo"), row.get("dia"))
            novo = corrigir_linha(row)
            print("DIAG:", novo["diagnostico"])
            for lista in CAMPOS_LIVRES:
                for item in novo[lista]:
                    print(f"  {lista.upper()[:6]}:", json.dumps(item, ensure_ascii=False))
        return 0

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes")
        return 1
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    st, corpo = _http(
        f"{url}/rest/v1/ai_briefings?tenant=eq.alagoinhas"
        "&select=dia,periodo,diagnostico,alertas,oportunidades,recomendacoes",
        headers,
    )
    if st != 200:
        print(f"GET ai_briefings falhou: HTTP {st} {corpo[:200]}")
        return 1
    rows = [r for r in json.loads(corpo) if linha_alvo(r)]
    print(f"{len(rows)} linha(s) sem acento no alvo")
    dry = "--dry-run" in sys.argv
    gravadas = 0
    for row in rows:
        novo = corrigir_linha(row)
        print(f"[{row['periodo']} {row['dia']}] depois: {novo['diagnostico'][:100]}…")
        if dry:
            continue
        payload = json.dumps([{
            "tenant": "alagoinhas", "dia": row["dia"], "periodo": row["periodo"], **novo,
        }]).encode()
        st, corpo = _http(
            f"{url}/rest/v1/ai_briefings?on_conflict=tenant,dia,periodo",
            {**headers, "Content-Type": "application/json",
             "Prefer": "resolution=merge-duplicates,return=minimal"},
            data=payload, method="POST",
        )
        if st in (200, 201, 204):
            gravadas += 1
        else:
            print(f"  upsert falhou: HTTP {st} {corpo[:200]}")
    print(f"{gravadas} linha(s) regravada(s)" + (" (dry-run)" if dry else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
