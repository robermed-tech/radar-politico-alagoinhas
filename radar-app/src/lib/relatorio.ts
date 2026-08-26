/**
 * Relatório do clima em PDF (06/08/26, pedido do cliente): os destaques do
 * período escolhido mais um resumo POR ESCRITO do clima do momento.
 *
 * Duas decisões que valem registro:
 *
 * 1. **O texto é montado por código, não pelo modelo.** O relatório precisa
 *    sair na hora, sempre, inclusive quando a API da Anthropic está sem
 *    crédito (incidente de 01/08) — e principalmente aí, que é quando o
 *    briefing do dia não foi gerado. O diagnóstico da IA entra como uma seção
 *    A MAIS quando existe, nunca como a única fonte do resumo.
 * 2. **Os números são os MESMOS da tela.** IAD, ICA, piso de sinal e a
 *    agregação por tema/perfil vêm de `lib/indices.ts` e `lib/agrupamento.ts`,
 *    os módulos que a Análise do Clima usa. Um PDF que contradiz o painel de
 *    onde saiu é pior que não ter PDF.
 *
 * O recorte de comentários é feito cruzando `url_post` com os posts da janela
 * (nunca por `data_comentario_ts`, com backfill parcial) — a mesma regra da
 * revisão de 27/07 e do `agora.py::contar_comentarios_por_tema`.
 */
import { PDF, medirTexto, type Cor } from "./pdf";
import {
  filtrarPorPeriodo, type Briefing, type Comment, type Post,
} from "./data";
import { agrupar } from "./agrupamento";
import {
  calcIAD, calcICA, temSinalIAD, votosDeSentimento, MIN_VOTOS_IAD,
} from "./indices";
import { getWeather } from "./weather";
import { vozDestacavel } from "./sentimento";
import { fmtInt, limparTravessoes } from "./format";
import { periodoFrase, periodoLabel, type Dias } from "@/components/PeriodoFilter";

/* Paleta do documento (11/08/26: o impresso passou a carregar a identidade do
   painel). Mesmas famílias do index.css, traduzidas para papel: tinta chumbo
   frio, painéis off-white, marca #62C2CA com tinta escura #04242F por cima (a
   regra auditada dos botões: nunca branco sobre a marca), e verde/vermelho
   continuam reservados a sentimento. Cor 0..1, como o PDF espera. */
const TINTA: Cor = [0.016, 0.141, 0.184];      // #04242F — txt1 do tema claro
const SUAVE: Cor = [0.357, 0.451, 0.490];      // #5B737D — txt3 do tema claro
const MARCA: Cor = [0.384, 0.761, 0.792];      // #62C2CA — hex único da marca
const MARCA_TINTA: Cor = [0.016, 0.141, 0.184]; // #04242F — tinta sobre a marca
const MARCA_ARESTA: Cor = [0.227, 0.604, 0.643]; // #3A9AA4 — aresta da banda
const NEG: Cor = [0.76, 0.15, 0.15];           // sent-ink-neg
const POS: Cor = [0.07, 0.48, 0.24];           // sent-ink-pos
const CAIXA: Cor = [0.929, 0.953, 0.957];      // #EDF3F4 — o off-white da página
const TRILHO: Cor = [0.851, 0.894, 0.902];     // #D9E4E6 — hairline frio

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Data e hora de emissão em dd/mm/aa às hh:mm. */
function carimbo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface ResumoRelatorio {
  posts: number;
  comentarios: number;
  iad: number;
  ica: number;
  semSinal: boolean;
  votos: number;
  pctPos: number;
  pctNeg: number;
  pctNeu: number;
}

/** Números do período — a mesma conta da Análise do Clima. */
export function medirPeriodo(posts: Post[], dias: Dias): ResumoRelatorio & { lista: Post[] } {
  const lista = filtrarPorPeriodo(posts, dias);
  const total = lista.reduce((s, p) => s + (p.comentarios_total || 0), 0);
  const somaPos = lista.reduce(
    (s, p) => s + ((p.comentarios_pct_pos || 0) / 100) * (p.comentarios_total || 0), 0
  );
  const somaNeg = lista.reduce(
    (s, p) => s + ((p.comentarios_pct_neg || 0) / 100) * (p.comentarios_total || 0), 0
  );
  const pctPos = total > 0 ? Math.round((somaPos / total) * 100) : 0;
  const pctNeg = total > 0 ? Math.round((somaNeg / total) * 100) : 0;
  return {
    lista,
    posts: lista.length,
    comentarios: total,
    iad: Math.round(calcIAD(lista)),
    ica: Math.round(calcICA(lista)),
    // Sem votos suficientes o IAD converge para 50 e o relatório afirmaria
    // empate técnico onde ninguém foi medido (ver MIN_VOTOS_IAD).
    semSinal: !temSinalIAD(lista),
    votos: votosDeSentimento(lista),
    pctPos,
    pctNeg,
    pctNeu: Math.max(0, 100 - pctPos - pctNeg),
  };
}

/**
 * O resumo escrito do clima — prosa, não bullet. É a parte que o assessor lê
 * antes de olhar qualquer número, então diz o que está acontecendo, o quanto
 * disso é medida confiável e onde está o ponto mais quente.
 */
export function resumoEscrito(
  r: ResumoRelatorio,
  temaCritico: { rotulo: string; pNeg: number } | undefined,
  dias: Dias
): string[] {
  const janela = periodoFrase(dias);
  const paragrafos: string[] = [];

  if (r.posts === 0) {
    return [
      `Nenhuma publicação monitorada entrou na análise ${janela}. Sem publicação não há ` +
      `comentário para medir, então o relatório do período fica sem clima a relatar. ` +
      `Se isso se repetir, o aviso de coleta no topo do painel diz qual serviço parou.`,
    ];
  }

  const wx = getWeather(r.iad);
  if (r.semSinal) {
    paragrafos.push(
      `${janela.charAt(0).toUpperCase()}${janela.slice(1)}, o radar analisou ` +
      `${fmtInt(r.posts)} ${r.posts === 1 ? "publicação" : "publicações"} e ` +
      `${fmtInt(r.comentarios)} ${r.comentarios === 1 ? "comentário" : "comentários"}, mas ` +
      `${r.votos === 0 ? "nenhum comentário foi classificado" : `só ${r.votos} ${r.votos === 1 ? "comentário foi classificado" : "comentários foram classificados"}`}` +
      ` com confiança suficiente, abaixo do mínimo de ${MIN_VOTOS_IAD}. Por isso o relatório ` +
      `não apresenta índice de aprovação: com essa amostra, um único comentário mudaria a ` +
      `faixa de clima exibida.`
    );
  } else {
    paragrafos.push(
      `${janela.charAt(0).toUpperCase()}${janela.slice(1)}, o radar analisou ` +
      `${fmtInt(r.posts)} ${r.posts === 1 ? "publicação" : "publicações"} e ` +
      `${fmtInt(r.comentarios)} ${r.comentarios === 1 ? "comentário" : "comentários"}. ` +
      `O clima está em "${wx.label}": ${limparTravessoes(wx.sub).toLowerCase()}. ` +
      `O índice de aprovação digital está em ${r.iad}%, ou seja, ${r.iad}% dos comentários ` +
      `que tomam partido aprovam a gestão.`
    );
    paragrafos.push(
      `Na decomposição dos comentários, ${pct(r.pctNeg)} são críticas à gestão, ` +
      `${pct(r.pctPos)} são elogios e ${pct(r.pctNeu)} não tomam partido. ` +
      `A confiança da amostra é de ${r.ica}%` +
      (r.ica < 40
        ? ", abaixo do que se considera confiável, então leia os percentuais como tendência e não como medida fechada."
        : ", volume suficiente para ler os percentuais como tendência do período.")
    );
  }

  if (temaCritico && temaCritico.pNeg > 0) {
    const nivel = temaCritico.pNeg >= 50 ? "crítico" : temaCritico.pNeg >= 30 ? "de atenção" : "sob monitoramento";
    paragrafos.push(
      `O tema mais pressionado é "${temaCritico.rotulo}", com ${temaCritico.pNeg}% de ` +
      `comentários negativos, o que o coloca em patamar ${nivel}. É por onde começar a ` +
      `resposta desta janela.`
    );
  }

  return paragrafos;
}

/** Seção com título em caixa alta e fio, o padrão do documento: tique laranja
 *  da marca antes do rótulo (o section-label do painel traduzido para papel). */
function secao(pdf: PDF, titulo: string): void {
  pdf.precisa(34);
  pdf.espaco(6);
  const topo = pdf.y;
  pdf.retangulo(pdf.margem, topo - 9.5, 3, 9.5, MARCA);
  pdf.linha(titulo.toUpperCase(), { x: pdf.margem + 9, tamanho: 9.5, bold: true, cor: TINTA });
  pdf.retangulo(pdf.margem, pdf.y + 2, pdf.larguraUtil, 0.7, TRILHO);
  pdf.espaco(8);
}

/** Faixa de KPIs: caixa creme com fio da marca no topo, número grande, rótulo
 *  pequeno — o card de vidro do painel traduzido para papel. */
function kpis(pdf: PDF, itens: { rotulo: string; valor: string; nota?: string }[]): void {
  const altura = 56;
  pdf.precisa(altura + 10);
  const vao = 8;
  const largura = (pdf.larguraUtil - vao * (itens.length - 1)) / itens.length;
  const topo = pdf.y;
  itens.forEach((it, i) => {
    const x = pdf.margem + i * (largura + vao);
    pdf.retangulo(x, topo - altura, largura, altura, CAIXA);
    pdf.retangulo(x, topo - 2, largura, 2, MARCA);
    pdf.textoEm(pdf.cortar(it.rotulo.toUpperCase(), largura - 18, 7.5, true), x + 9, topo - 16, {
      tamanho: 7.5, bold: true, cor: SUAVE,
    });
    pdf.textoEm(it.valor, x + 9, topo - 36, { tamanho: 17, bold: true, cor: TINTA });
    if (it.nota) {
      pdf.textoEm(pdf.cortar(it.nota, largura - 18, 7.5), x + 9, topo - 48, {
        tamanho: 7.5, cor: SUAVE,
      });
    }
  });
  pdf.espaco(altura + 10);
}

/** Linha de ranking: rótulo, barra proporcional e os dois percentuais. */
function linhaRanking(
  pdf: PDF,
  rotulo: string,
  pNeg: number,
  pPos: number,
  nota: string
): void {
  pdf.precisa(26);
  const topo = pdf.y;
  const larguraRotulo = 150;
  const larguraBarra = pdf.larguraUtil - larguraRotulo - 96;
  pdf.textoEm(pdf.cortar(rotulo, larguraRotulo - 8, 10, true), pdf.margem, topo - 11, {
    tamanho: 10, bold: true, cor: TINTA,
  });
  pdf.textoEm(nota, pdf.margem, topo - 21, { tamanho: 7.5, cor: SUAVE });
  const x = pdf.margem + larguraRotulo;
  pdf.retangulo(x, topo - 16, larguraBarra, 7, TRILHO);
  pdf.retangulo(x, topo - 16, (larguraBarra * Math.min(100, Math.max(0, pNeg))) / 100, 7, NEG);
  pdf.textoEm(`${pNeg}% críticas`, x + larguraBarra + 10, topo - 10, { tamanho: 8.5, bold: true, cor: NEG });
  pdf.textoEm(`${pPos}% elogios`, x + larguraBarra + 10, topo - 20, { tamanho: 8.5, bold: true, cor: POS });
  pdf.espaco(28);
}

/** Citação de cidadão: painel creme (o ComentarioBox do painel em papel) com
 *  fio de sentimento, texto e assinatura. */
function citacao(pdf: PDF, c: Comment, cor: Cor): void {
  const texto = limparTravessoes(c.texto || "").slice(0, 260);
  const linhas = pdf.quebrar(texto, pdf.larguraUtil - 22, 9.5);
  const altura = linhas.length * 12.5 + 16;
  pdf.precisa(altura + 6);
  const topo = pdf.y;
  pdf.retangulo(pdf.margem, topo - altura, pdf.larguraUtil, altura, CAIXA);
  pdf.retangulo(pdf.margem, topo - altura, 2.5, altura, cor);
  linhas.forEach((l, i) => {
    pdf.textoEm(l, pdf.margem + 12, topo - 11 - i * 12.5, { tamanho: 9.5, cor: TINTA });
  });
  pdf.textoEm(
    `@${c.username || "sem identificação"} · em @${c.autor_post} · ${fmtInt(c.curtidas || 0)} curtidas`,
    pdf.margem + 12,
    topo - altura + 4,
    { tamanho: 7.5, cor: SUAVE }
  );
  pdf.espaco(altura + 8);
}

export interface EntradaRelatorio {
  dias: Dias;
  posts: Post[];
  comentarios: Comment[];
  briefing: Briefing | null;
  /** Nome exibido no cabeçalho (cliente/cidade). */
  tenant?: string;
}

export interface SaidaRelatorio {
  blob: Blob;
  nomeArquivo: string;
}

export function gerarRelatorioPDF(entrada: EntradaRelatorio): SaidaRelatorio {
  const { dias, posts, comentarios, briefing } = entrada;
  const r = medirPeriodo(posts, dias);
  const rotulo = periodoLabel(dias);
  const emitido = new Date();

  const porTema = agrupar(r.lista, (p) => p.tema, 8).sort((a, b) => b.pNeg - a.pNeg);
  const porPerfil = agrupar(r.lista, (p) => `@${p.autor}`, 8)
    .slice()
    .sort((a, b) => b.coments - a.coments);

  // Comentários da janela: cruzamento por url_post com os posts do período.
  const urls = new Set(r.lista.map((p) => p.url));
  const cidadaos = comentarios.filter(
    (c) => c.tipo === "cidadao" && urls.has(c.url_post) && vozDestacavel(c)
  );
  const ordenar = (a: Comment, b: Comment) => (b.curtidas || 0) - (a.curtidas || 0);
  const criticas = cidadaos.filter((c) => c.sentimento === "negativo").sort(ordenar).slice(0, 3);
  const elogios = cidadaos.filter((c) => c.sentimento === "positivo").sort(ordenar).slice(0, 3);

  const pdf = new PDF({
    titulo: `Viratempo · relatório do clima (${rotulo})`,
    rodape: `Viratempo · relatório gerado em ${carimbo(emitido)}`,
    // Identidade em toda página: faixa da marca no topo (coberta na primeira
    // pela banda do cabeçalho) e o quadradinho da marca antes do rodapé.
    faixaTopo: MARCA,
    pontoRodape: MARCA,
  });

  // ── Cabeçalho: banda da marca com a logomarca do painel ──────
  // Teal #62C2CA de ponta a ponta, tinta escura #04242F por cima (a regra
  // de contraste dos botões de marca: 7,77:1; branco mediria 2,08:1) e uma
  // aresta um tom abaixo fechando a banda.
  const BANDA = 84;
  const baseBanda = PDF.ALTURA - BANDA;
  pdf.retangulo(0, baseBanda, PDF.LARGURA, BANDA, MARCA);
  pdf.retangulo(0, baseBanda, PDF.LARGURA, 2.5, MARCA_ARESTA);
  // Marca: o tique do arquivo oficial, em tinta escura, e o nome ao lado. O
  // aro de radar saiu junto com o símbolo do painel, e a tagline "Radar do
  // clima político" saiu de todo lugar (decisão de 26/08/26).
  const cyBanda = baseBanda + BANDA / 2;
  const TIQUE = 26;
  pdf.tique(pdf.margem, cyBanda - (TIQUE * PDF.TIQUE_PROPORCAO) / 2, TIQUE, MARCA_TINTA);
  pdf.textoEm("VIRATEMPO", pdf.margem + TIQUE + 14, cyBanda - 6.5, {
    tamanho: 21, bold: true, cor: MARCA_TINTA,
  });
  // Chip do período à direita, como os chips do painel: fundo escuro quase
  // sólido com texto claro (a mesma receita dos chips sobre degradê).
  const chipTexto = rotulo.toUpperCase();
  const chipLargura = medirTexto(chipTexto, 8, true) + 16;
  const chipX = PDF.LARGURA - pdf.margem - chipLargura;
  pdf.retangulo(chipX, cyBanda - 8, chipLargura, 17, MARCA_TINTA);
  pdf.textoEm(chipTexto, chipX + 8, cyBanda - 2.5, { tamanho: 8, bold: true, cor: CAIXA });
  pdf.y = baseBanda - 24;

  pdf.linha(`Relatório do clima · ${rotulo}`, { tamanho: 23, bold: true, cor: TINTA });
  pdf.retangulo(pdf.margem, pdf.y + 4, 64, 3, MARCA);
  pdf.espaco(12);
  pdf.linha(
    `${entrada.tenant ? `${entrada.tenant} · ` : ""}Emitido em ${carimbo(emitido)}`,
    { tamanho: 9, cor: SUAVE, espacoDepois: 6 }
  );

  // ── Resumo escrito ───────────────────────────────────────────
  secao(pdf, "Resumo do clima");
  const temaCritico = porTema[0];
  for (const p of resumoEscrito(r, temaCritico, dias)) {
    pdf.paragrafo(p, { tamanho: 10.5, cor: TINTA, espacoDepois: 7 });
  }

  // ── Números ──────────────────────────────────────────────────
  secao(pdf, "Números do período");
  kpis(pdf, [
    {
      rotulo: "Aprovação digital",
      valor: r.semSinal ? "sem sinal" : `${r.iad}%`,
      nota: r.semSinal ? `${r.votos} de ${MIN_VOTOS_IAD} votos` : "dos que tomam partido",
    },
    { rotulo: "Publicações", valor: fmtInt(r.posts), nota: "analisadas na janela" },
    { rotulo: "Comentários", valor: fmtInt(r.comentarios), nota: "coletados na janela" },
    {
      rotulo: "Confiança da amostra",
      valor: `${r.ica}%`,
      nota: r.ica < 40 ? "amostra insuficiente" : "amostra confiável",
    },
  ]);
  if (r.comentarios > 0) {
    pdf.paragrafo(
      `Decomposição dos comentários: ${pct(r.pctNeg)} de críticas, ${pct(r.pctPos)} de elogios ` +
      `e ${pct(r.pctNeu)} sem tomar partido.`,
      { tamanho: 9.5, cor: SUAVE, espacoDepois: 4 }
    );
  }

  // ── Temas ────────────────────────────────────────────────────
  if (porTema.length) {
    secao(pdf, "Temas que mais pressionam");
    for (const t of porTema.slice(0, 5)) {
      linhaRanking(
        pdf,
        t.rotulo,
        t.pNeg,
        t.pPos,
        `${t.posts} ${t.posts === 1 ? "publicação" : "publicações"} · ${fmtInt(t.coments)} ${t.coments === 1 ? "comentário" : "comentários"}`
      );
    }
  }

  // ── Perfis ───────────────────────────────────────────────────
  if (porPerfil.length) {
    secao(pdf, "Perfis que mais mobilizaram");
    for (const p of porPerfil.slice(0, 5)) {
      linhaRanking(
        pdf,
        p.rotulo,
        p.pNeg,
        p.pPos,
        `${p.cat || "sem categoria"} · ${fmtInt(p.coments)} ${p.coments === 1 ? "comentário" : "comentários"}`
      );
    }
  }

  // ── Vozes ────────────────────────────────────────────────────
  if (criticas.length || elogios.length) {
    secao(pdf, "Vozes da população");
    if (criticas.length) {
      pdf.linha("Mais curtidas entre as críticas", { tamanho: 10, bold: true, cor: NEG, espacoDepois: 4 });
      criticas.forEach((c) => citacao(pdf, c, NEG));
    }
    if (elogios.length) {
      pdf.espaco(2);
      pdf.linha("Mais curtidas entre os elogios", { tamanho: 10, bold: true, cor: POS, espacoDepois: 4 });
      elogios.forEach((c) => citacao(pdf, c, POS));
    }
  }

  // ── Diagnóstico da IA (quando existe) ────────────────────────
  if (briefing?.diagnostico) {
    secao(pdf, "Diagnóstico da análise assistida");
    pdf.paragrafo(limparTravessoes(briefing.diagnostico), {
      tamanho: 10.5, cor: TINTA, espacoDepois: 6,
    });
    const alertas = (briefing.alertas ?? []).slice(0, 4);
    if (alertas.length) {
      pdf.linha("Alertas apontados", { tamanho: 10, bold: true, cor: TINTA, espacoDepois: 3 });
      alertas.forEach((a) => {
        pdf.paragrafo(`- ${limparTravessoes(a.tema)} (${limparTravessoes(a.nivel)})`, {
          tamanho: 9.5, cor: TINTA,
        });
      });
      pdf.espaco(4);
    }
    const recomendacoes = (briefing.recomendacoes ?? []).slice(0, 3);
    if (recomendacoes.length) {
      pdf.linha("Sugestões a serem avaliadas por especialista", {
        tamanho: 10, bold: true, cor: TINTA, espacoDepois: 3,
      });
      recomendacoes.forEach((rec) => {
        pdf.paragrafo(`- ${limparTravessoes(rec.canal)}: ${limparTravessoes(rec.mensagem)}`, {
          tamanho: 9.5, cor: TINTA, espacoDepois: 2,
        });
      });
    }
  }

  // ── Nota de método ───────────────────────────────────────────
  secao(pdf, "Como ler estes números");
  pdf.paragrafo(
    `A aprovação digital mede a parcela dos comentários que tomam partido e aprovam a gestão; ` +
    `comentários que não avaliam a gestão entram no total como neutros e não puxam o índice ` +
    `para nenhum lado. Só entra na conta comentário de cidadão com classificação confiável, e ` +
    `abaixo de ${MIN_VOTOS_IAD} comentários classificados o índice não é exibido. A confiança da ` +
    `amostra indica o volume por trás dos percentuais. Os comentários do período são os das ` +
    `publicações da janela.`,
    { tamanho: 8.5, cor: SUAVE }
  );

  const iso = emitido.toISOString().slice(0, 10);
  // Nome de arquivo sem acento nem espaço: `periodoLabel` devolve "últimas 24h"
  // e um "ú" no nome quebra em servidor de arquivos e em anexo de e-mail.
  const janela = dias === 1 ? "24h" : `${dias}dias`;
  return {
    blob: pdf.blob(),
    nomeArquivo: `viratempo-clima-${janela}-${iso}.pdf`,
  };
}
