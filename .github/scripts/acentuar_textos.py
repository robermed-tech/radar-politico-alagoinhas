# -*- coding: utf-8 -*-
"""Acentuação determinística dos textos gerados e gravados sem acento (06/08/26).

O reparo via modelo (`agora.py --reparar-acentos-briefings`) depende da API
Anthropic, que está sem crédito ("credit balance is too low", issue
reparo-acentos). Este script não depende de modelo nenhum: aplica um mapa de
correções DERIVADO DO CORPUS REAL — cada n-grama e cada palavra do dicionário
foi conferido ocorrência por ocorrência (inclusive os ambíguos: "critica"
verbo fica sem acento, "esta semana" fica pronome, crase só onde a regência
pede).

Cobre duas tabelas, porque o mesmo defeito atinge as duas:
- `ai_briefings` (diagnóstico, alertas, oportunidades, recomendações), que a
  Estação Meteorológica exibe;
- `posts` (resumo, queixa_dominante, elogio_dominante), que o Feed "O que o
  povo diz" exibe — 155 textos, o volume maior.

Salvaguardas:
- Só toca texto que não tem NENHUM acento (o mesmo critério da sonda de
  diagnóstico) — texto já acentuado nem entra no mapa, porque os ambíguos
  foram validados só neste corpus. Idempotente por construção.
- Depois do mapa, o texto normalizado (NFD sem marcas de combinação) tem que
  ser IDÊNTICO ao de antes — qualquer mudança além de diacríticos aborta o
  texto. As exceções de grafia (CORRECOES_EXATAS) rodam antes e são
  substituições literais fechadas.
- PROTEGIDOS blinda trechos onde a mesma grafia é de OUTRA classe gramatical
  ("o período critica a gestão" é verbo; "crítica direta à gestão" é
  substantivo). O trecho vira um marcador ANTES de tudo e volta acentuado à
  mão no fim, fora do alcance de n-gramas e do dicionário. Sem isso, o
  dicionário acentuaria o verbo — foi o que o teste de regressão pegou ao
  juntar os dois corpora.

Uso:
  python acentuar_textos.py                  # aplica no Supabase (env)
  python acentuar_textos.py --dry-run        # mostra sem gravar
  python acentuar_textos.py --local arq.json # aplica num dump local (teste)
"""
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# Erros de grafia e de gramática reais (mudam letras, não só diacríticos):
# substituição literal com contexto suficiente para não casar em outro lugar.
# Os quatro últimos vieram da revisão adversarial de 06/08 sobre os posts:
# concordância de "expõe/expõem" (sujeito plural), "mal/mau" (advérbio vs
# adjetivo) e "desconexa/desconexão" (adjetivo no lugar de substantivo, erro
# do próprio modelo que gerou o texto — "desconexão" aparece correto em outro
# texto do mesmo lote). Cada um foi conferido como ocorrência única no corpus.
CORRECOES_EXATAS = [
    ("Empatetico e resolutivo", "Empático e resolutivo"),
    ("empaticocom os pacientes", "empático com os pacientes"),
    ("sem juridiquese.", "sem juridiquês."),
    ("comentarios expoe diretamente", "comentários expõem diretamente"),
    ("comparacoes que expoe tratamento", "comparações que expõem tratamento"),
    ("ruas em mal estado", "ruas em mau estado"),
    ("sugere desconexa entre", "sugere desconexão entre"),
    # Segunda rodada de revisão: só o que é acréscimo mínimo e não muda o
    # sentido da análise. Sugestões de REESCRITA ficaram de fora de propósito
    # ("indiferente ou descaso", concordância de particípio distante, mistura
    # de tempos verbais): o texto é registro histórico da análise, e reescrevê-lo
    # é pior que exibi-lo imperfeito. Ficam anotadas no CLAUDE.md.
    ("descontentamento paralelo com gestao", "descontentamento paralelo com a gestão"),
    ("Unico comentario e de total apoio", "O único comentário é de total apoio"),
    # Travessão é proibido em texto gerado (regra do projeto). O Feed já
    # limpa na exibição, mas a mensagem de WhatsApp do alerta não.
    ("de comentarios — nao representa", "de comentários, não representa"),
]

# (origem crua, versão final escrita à mão) para trechos em que a grafia é de
# outra classe gramatical. Roda ANTES de tudo e volta no fim, então nem os
# n-gramas nem o dicionário alcançam o miolo. "critica" é o caso do corpus:
# nos briefings, "a maioria dos comentários do período critica a gestão" é
# VERBO (fica sem acento e sem crase); nos posts, 16 das 17 ocorrências são
# substantivo ("crítica direta à gestão") e só "um deles critica diretamente"
# é verbo.
PROTEGIDOS = [
    ("periodo critica a gestao", "período critica a gestão"),
    ("periodo critica a administracao", "período critica a administração"),
    ("deles critica diretamente", "deles critica diretamente"),
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

    # ── Corpus de `posts` (Feed). Conferidos ocorrência por ocorrência. ──
    # "e" que é verbo ser (o resto do corpus é conjunção e fica intacto)
    ("comentario e um", "comentário é um"),
    ("comentario e uma", "comentário é uma"),
    ("comentario e de", "comentário é de"),
    ("comentario do post e uma", "comentário do post é uma"),
    ("post e positivo", "post é positivo"),
    ("negativa e vista", "negativa é vista"),
    # verbos que o dicionário não pode cobrir (a mesma grafia é substantivo)
    ("nao esta preparada", "não está preparada"),
    ("comunicacao previa", "comunicação prévia"),
    ("por denuncia de", "por denúncia de"),
    ("por denuncia direta", "por denúncia direta"),
    ("a denuncia da oposicao", "a denúncia da oposição"),
    # Crase: SÓ onde a regência do nome pede (os demais " a " do corpus são
    # objeto direto de verbo — "avaliar a gestão", "elogiam a vereadora" — e
    # ficam sem crase de propósito).
    ("mencao a gestao", "menção à gestão"),
    ("referencia a gestao", "referência à gestão"),
    ("credito a gestao", "crédito à gestão"),
    ("critica a gestao", "crítica à gestão"),
    ("criticas a gestao", "críticas à gestão"),
    ("indireta a gestao", "indireta à gestão"),
    ("direta a gestao", "direta à gestão"),
    ("elogiosa a gestao", "elogiosa à gestão"),
    ("desfavoravel a gestao", "desfavorável à gestão"),
    ("dano a imagem", "dano à imagem"),
    ("critica a taxa", "crítica à taxa"),
    ("direta as autoridades", "direta às autoridades"),
    ("apoio a doacao", "apoio à doação"),
    ("elogio a vereadora", "elogio à vereadora"),
    # Crases apontadas pela revisão adversarial de 06/08. Cada uma tem
    # ocorrência única e o núcleo é feminino com artigo; os "a" masculinos do
    # mesmo corpus ("apoio a Joaquim Neto", "visita a equipamento público")
    # continuam intactos por não casarem nestes padrões.
    ("prefeito e a gestao", "prefeito e à gestão"),
    ("dano direto a imagem", "dano direto à imagem"),
    ("objetivamente a pergunta", "objetivamente à pergunta"),
    # Contexto LONGO de propósito: "elogios ao projeto X e à vereadora" tem
    # crase (regência de "elogios a"), mas "encontro entre o prefeito e a
    # vereadora" é enumeração e NÃO tem — o teste de regressão dos briefings
    # pegou o padrão curto acentuando o segundo caso.
    ("e a vereadora Jaldice Nunes pelo apoio", "e à vereadora Jaldice Nunes pelo apoio"),
    ("junto a secretaria", "junto à secretaria"),
    ("apoio a opositora", "apoio à opositora"),
    ("pessoal a opositora", "pessoal à opositora"),
    ("foco da visita a creche", "foco da visita à creche"),
    # Enclíticas e o "só" advérbio: acento que o dicionário por palavra não
    # alcança sozinho (o hífen separa "coloca" de "lo").
    ("ao coloca-lo em", "ao colocá-lo em"),
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

    # ── Vocabulário adicional do corpus de `posts` (Feed). Ambíguos ficam
    # FORA daqui e são tratados por n-grama/PROTEGIDOS: "denuncia", "previa",
    # "seria" (verbo no corpus), "esta". "critica" entra porque 16 das 17
    # ocorrências são substantivo e a única verbal está em PROTEGIDOS. ──
    "admiracao": "admiração", "admissao": "admissão", "agua": "água",
    "aniversario": "aniversário", "aparicoes": "aparições",
    "aspiracao": "aspiração", "associacoes": "associações",
    "atencao": "atenção", "audiencia": "audiência",
    "avaliacao": "avaliação", "basica": "básica", "basico": "básico",
    "basicos": "básicos", "caes": "cães", "citacao": "citação",
    "cobrancas": "cobranças", "comparacoes": "comparações",
    "condicoes": "condições", "contraditoria": "contraditória",
    "contratacoes": "contratações", "credito": "crédito",
    "criacao": "criação", "critica": "crítica", "decisoes": "decisões",
    "declaracoes": "declarações", "dedicacao": "dedicação",
    "desativacao": "desativação", "descartavel": "descartável",
    "desconexao": "desconexão", "descredito": "descrédito",
    "descrenca": "descrença", "desfavoravel": "desfavorável",
    "deterioracao": "deterioração", "dividas": "dívidas",
    "dao": "dão", "doacao": "doação", "eficiencia": "eficiência",
    "eleicoes": "eleições",
    "emocao": "emoção", "especifico": "específico", "etica": "ética",
    "fe": "fé",
    "exclamacao": "exclamação", "exoneracao": "exoneração",
    "explicitas": "explícitas", "expoe": "expõe", "forcada": "forçada",
    "forcou": "forçou", "fundacao": "fundação",
    "furao": "Furão", "generica": "genérica", "hipotese": "hipótese",
    "imunizacao": "imunização", "inauguracao": "inauguração",
    "incompetencia": "incompetência", "indignacao": "indignação",
    "inflacao": "inflação", "informacoes": "informações",
    "insatisfacao": "insatisfação", "ironico": "irônico",
    "ironicos": "irônicos", "jeronimo": "Jerônimo", "joao": "João",
    "justica": "justiça", "lanca": "lança", "le": "lê", "logica": "lógica",
    "mencao": "menção", "multiplos": "múltiplos", "nino": "Niño",
    "negligencia": "negligência", "negocio": "negócio",
    "notificacao": "notificação", "numeros": "números",
    "obrigacao": "obrigação", "ocorrera": "ocorrerá", "panico": "pânico",
    "participacao": "participação", "pedrao": "Pedrão",
    "performatico": "performático", "perifericos": "periféricos",
    "pessima": "péssima",
    "politicas": "políticas", "politicos": "políticos", "pracas": "praças",
    "pre": "pré", "precaria": "precária", "precarias": "precárias",
    "preocupacoes": "preocupações", "pressao": "pressão",
    "publicas": "públicas", "questao": "questão", "reacao": "reação",
    "realizacao": "realização", "referencia": "referência",
    "reforca": "reforça", "regulacao": "regulação", "relacao": "relação",
    "repercussao": "repercussão", "rescisao": "rescisão",
    "resolucao": "resolução", "salario": "salário", "salarios": "salários",
    "sarcasticos": "sarcásticos", "seguranca": "segurança", "sera": "será",
    "sessao": "sessão", "so": "só", "unico": "único", "validacao": "validação",
    "varios": "vários", "votacao": "votação", "ze": "Zé",
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
    """Aplica exatas -> n-gramas -> protegidos -> dicionário e valida NFD.
    Devolve o texto corrigido, ou o original se a validação reprovar."""
    base = texto
    for antes, depois in CORRECOES_EXATAS:
        base = base.replace(antes, depois)
    novo = base
    # Blinda primeiro: o marcador \x00N\x00 não casa com [A-Za-z]+ nem com
    # nenhum n-grama, então o miolo atravessa as duas etapas seguintes.
    for i, (origem, _) in enumerate(PROTEGIDOS):
        novo = novo.replace(origem, f"\x00{i}\x00")
    for antes, depois in NGRAMAS:
        novo = novo.replace(antes, depois)
    novo = _PALAVRA.sub(_troca_palavra, novo)
    for i, (_, final) in enumerate(PROTEGIDOS):
        novo = novo.replace(f"\x00{i}\x00", final)
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


# Campos de texto livre de `posts` que a UI exibe (Feed "O que o povo diz":
# resumoProsaPost usa resumo/queixa/elogio; ver lib/resumo.ts).
CAMPOS_POST = ("resumo", "queixa_dominante", "elogio_dominante")


def texto_alvo(v):
    """Texto gerado que ficou sem NENHUM acento — o mesmo critério da sonda."""
    return isinstance(v, str) and len(v.strip()) > 20 and not any(c in v for c in _ACENTOS)


def _reparar_briefings(url, headers, dry):
    st, corpo = _http(
        f"{url}/rest/v1/ai_briefings?tenant=eq.alagoinhas"
        "&select=dia,periodo,diagnostico,alertas,oportunidades,recomendacoes",
        headers,
    )
    if st != 200:
        print(f"GET ai_briefings falhou: HTTP {st} {corpo[:200]}")
        return None
    rows = [r for r in json.loads(corpo) if linha_alvo(r)]
    print(f"ai_briefings: {len(rows)} linha(s) sem acento")
    gravadas = 0
    for row in rows:
        novo = corrigir_linha(row)
        print(f"  [{row['periodo']} {row['dia']}] {novo['diagnostico'][:95]}…")
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
    return gravadas


def _reparar_posts(url, headers, dry):
    """`posts` é atualizado por PATCH na url (chave natural), e NUNCA por
    upsert: um upsert com só estas colunas apagaria o resto da análise."""
    st, corpo = _http(
        f"{url}/rest/v1/posts?tenant=eq.alagoinhas"
        f"&select=url,{','.join(CAMPOS_POST)}&limit=5000",
        headers,
    )
    if st != 200:
        print(f"GET posts falhou: HTTP {st} {corpo[:200]}")
        return None
    linhas = json.loads(corpo)
    gravadas, textos = 0, 0
    for p in linhas:
        mudou = {}
        for campo in CAMPOS_POST:
            v = p.get(campo)
            if texto_alvo(v):
                novo = acentuar(v)
                if novo != v:
                    mudou[campo] = novo
        if not mudou:
            continue
        textos += len(mudou)
        primeiro = next(iter(mudou.values()))
        print(f"  [{p['url'][-14:]}] {primeiro[:95]}…")
        if dry:
            continue
        # `url` pode ter caracteres que o PostgREST interpreta; usa filtro
        # in.("...") com aspas, que aceita a URL inteira como literal.
        alvo = p["url"].replace('"', '\\"')
        st, corpo = _http(
            f"{url}/rest/v1/posts?tenant=eq.alagoinhas&url=in.(%22{urllib.parse.quote(alvo, safe='')}%22)",
            {**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            data=json.dumps(mudou).encode(), method="PATCH",
        )
        if st in (200, 204):
            gravadas += 1
        else:
            print(f"  patch falhou: HTTP {st} {corpo[:200]}")
    print(f"posts: {textos} texto(s) em {gravadas if not dry else '—'} linha(s)")
    return gravadas


def main():
    if "--local" in sys.argv:
        arq = sys.argv[sys.argv.index("--local") + 1]
        rows = json.load(open(arq))
        for row in rows:
            if "texto" in row:  # dump de posts: {url, campo, texto}
                print(f"===== {row.get('campo')} {row.get('url','')[-14:]}")
                print(acentuar(row["texto"]))
                continue
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
    dry = "--dry-run" in sys.argv
    a = _reparar_briefings(url, headers, dry)
    b = _reparar_posts(url, headers, dry)
    if a is None or b is None:
        return 1
    print(f"TOTAL: {a} briefing(s) e {b} post(s) regravado(s)"
          + (" (dry-run: nada gravado)" if dry else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
