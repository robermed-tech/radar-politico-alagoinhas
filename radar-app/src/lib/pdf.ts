/**
 * Escritor de PDF mínimo — texto, retângulos e paginação. Zero dependência.
 *
 * Por que não uma biblioteca: o relatório é texto, régua e barra; a jsPDF
 * pesa ~350 KB e entraria no chunk de uma página do painel para desenhar o que
 * cabe em duzentas linhas. O painel já paga um chunk grande de ECharts e a
 * regra do projeto é não repetir esse custo quando SVG (ou, aqui, o próprio
 * formato) resolve.
 *
 * Codificação: as fontes-base Helvetica são declaradas com WinAnsiEncoding, e
 * cada caractere vira UM byte. Todo acento do português está no Latin-1, então
 * "gestão", "saúde" e "críticas" saem corretos; os poucos sinais tipográficos
 * fora do Latin-1 (aspas curvas, reticências) têm posição própria no CP1252 e
 * são traduzidos em `_CP1252`. O que não existir vira "?" em vez de corromper
 * o arquivo.
 *
 * O arquivo inteiro é montado como string ASCII (byte >127 sai escapado em
 * octal), então `posição no texto === offset em bytes` e a tabela xref pode ser
 * calculada direto — é o que torna um escritor deste tamanho viável.
 */

export type Cor = [number, number, number]; // 0..1, como o PDF espera

/** Caracteres fora do Latin-1 que o CP1252 (base do WinAnsiEncoding) tem em
 *  posição própria. Sem isso uma aspa curva colada de um texto gerado viraria
 *  "?" no meio de uma citação. */
const _CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** Texto -> literal de string PDF, byte a byte. */
function escapar(texto: string): string {
  let saida = "";
  for (const ch of texto) {
    let c = ch.codePointAt(0) ?? 63;
    if (c > 255) c = _CP1252[c] ?? 63; // "?"
    if (c === 0x28 || c === 0x29 || c === 0x5c) saida += "\\" + String.fromCharCode(c);
    else if (c < 32 || c > 126) saida += "\\" + c.toString(8).padStart(3, "0");
    else saida += String.fromCharCode(c);
  }
  return saida;
}

/* Medição de texto pelo canvas do próprio navegador. Arial (o substituto da
   Helvetica no Windows) tem praticamente as mesmas larguras da Helvetica, e a
   margem de segurança de MARGEM_MEDIDA cobre a diferença: uma medida um pouco
   larga só quebra a linha mais cedo, enquanto uma curta deixaria texto sair da
   página. Sem canvas (SSR, teste), cai numa média conservadora. */
const MARGEM_MEDIDA = 1.03;
let _ctx: CanvasRenderingContext2D | null | undefined;

function contexto(): CanvasRenderingContext2D | null {
  if (_ctx !== undefined) return _ctx;
  try {
    _ctx = document.createElement("canvas").getContext("2d");
  } catch {
    _ctx = null;
  }
  return _ctx;
}

export function medirTexto(texto: string, tamanho: number, bold = false): number {
  const ctx = contexto();
  if (!ctx) return texto.length * tamanho * 0.55;
  ctx.font = `${bold ? "bold " : ""}${tamanho}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(texto).width * MARGEM_MEDIDA;
}

export interface OpcoesTexto {
  tamanho?: number;
  bold?: boolean;
  cor?: Cor;
  /** Espaço extra depois da última linha. */
  espacoDepois?: number;
  /** Largura de quebra. Default: largura útil da página. */
  largura?: number;
  /** Margem esquerda do bloco. Default: margem da página. */
  x?: number;
  /** Entrelinha como múltiplo do corpo. */
  entrelinha?: number;
}

export class PDF {
  static readonly LARGURA = 595.28; // A4 retrato, em pontos
  static readonly ALTURA = 841.89;

  readonly margem = 46;
  /** Cursor vertical: distância do topo do próximo bloco até a base da página. */
  y = PDF.ALTURA - 46;

  private paginas: string[] = [];
  private buffer: string[] = [];
  private titulo: string;
  /** Desenhado no rodapé de toda página, à esquerda. */
  private rodape: string;

  constructor(opcoes: { titulo: string; rodape?: string }) {
    this.titulo = opcoes.titulo;
    this.rodape = opcoes.rodape ?? "";
  }

  get larguraUtil(): number {
    return PDF.LARGURA - this.margem * 2;
  }

  /** Altura mínima reservada para o rodapé + respiro. */
  private get pisoConteudo(): number {
    return this.margem + 26;
  }

  novaPagina(): void {
    this.paginas.push(this.buffer.join("\n"));
    this.buffer = [];
    this.y = PDF.ALTURA - this.margem;
  }

  /** Abre página nova se o bloco de altura `h` não couber no que sobrou. */
  precisa(h: number): void {
    if (this.y - h < this.pisoConteudo) this.novaPagina();
  }

  espaco(h: number): void {
    this.y -= h;
  }

  retangulo(x: number, base: number, largura: number, altura: number, cor: Cor): void {
    this.buffer.push(
      `${cor[0]} ${cor[1]} ${cor[2]} rg ${x.toFixed(2)} ${base.toFixed(2)} ` +
      `${largura.toFixed(2)} ${altura.toFixed(2)} re f`
    );
  }

  /** Texto numa posição absoluta, sem mexer no cursor — para o que é desenhado
   *  dentro de uma caixa (KPI, célula de tabela), onde o fluxo vertical é o da
   *  caixa e não o da página. */
  textoEm(texto: string, x: number, base: number, op: OpcoesTexto = {}): void {
    const tamanho = op.tamanho ?? 10.5;
    const cor = op.cor ?? [0.1, 0.1, 0.12];
    this.buffer.push(
      `BT /${op.bold ? "F2" : "F1"} ${tamanho} Tf ${cor[0]} ${cor[1]} ${cor[2]} rg ` +
      `1 0 0 1 ${x.toFixed(2)} ${base.toFixed(2)} Tm (${escapar(texto)}) Tj ET`
    );
  }

  /** Uma linha de texto na posição corrente; NÃO quebra. Move o cursor. */
  linha(texto: string, op: OpcoesTexto = {}): void {
    const tamanho = op.tamanho ?? 10.5;
    const cor = op.cor ?? [0.1, 0.1, 0.12];
    const x = op.x ?? this.margem;
    const entrelinha = op.entrelinha ?? 1.32;
    this.precisa(tamanho * entrelinha);
    const base = this.y - tamanho;
    this.buffer.push(
      `BT /${op.bold ? "F2" : "F1"} ${tamanho} Tf ${cor[0]} ${cor[1]} ${cor[2]} rg ` +
      `1 0 0 1 ${x.toFixed(2)} ${base.toFixed(2)} Tm (${escapar(texto)}) Tj ET`
    );
    this.y -= tamanho * entrelinha + (op.espacoDepois ?? 0);
  }

  /** Quebra o texto na largura disponível e desenha as linhas. */
  paragrafo(texto: string, op: OpcoesTexto = {}): void {
    const tamanho = op.tamanho ?? 10.5;
    const largura = op.largura ?? this.larguraUtil;
    for (const linha of this.quebrar(texto, largura, tamanho, op.bold)) {
      this.linha(linha, { ...op, espacoDepois: 0 });
    }
    this.y -= op.espacoDepois ?? 0;
  }

  quebrar(texto: string, largura: number, tamanho: number, bold = false): string[] {
    const palavras = String(texto ?? "").split(/\s+/).filter(Boolean);
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p;
      if (medirTexto(teste, tamanho, bold) <= largura || !atual) atual = teste;
      else {
        linhas.push(atual);
        atual = p;
      }
    }
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [""];
  }

  /** Corta o texto com reticências para caber numa largura (rótulo de tabela). */
  cortar(texto: string, largura: number, tamanho: number, bold = false): string {
    if (medirTexto(texto, tamanho, bold) <= largura) return texto;
    let corte = texto;
    while (corte.length > 1 && medirTexto(corte + "...", tamanho, bold) > largura) {
      corte = corte.slice(0, -1);
    }
    return corte + "...";
  }

  /** Régua horizontal fina, largura útil. */
  regua(cor: Cor = [0.85, 0.84, 0.82]): void {
    this.precisa(6);
    this.retangulo(this.margem, this.y - 2, this.larguraUtil, 0.8, cor);
    this.y -= 8;
  }

  private desenharRodapes(): void {
    // Rodapé é escrito no fim, quando o total de páginas já é conhecido.
    const total = this.paginas.length;
    this.paginas = this.paginas.map((conteudo, i) => {
      const cor: Cor = [0.45, 0.45, 0.48];
      const base = this.margem - 12;
      const pagina = `${i + 1} de ${total}`;
      const larguraPagina = medirTexto(pagina, 8.5);
      return [
        conteudo,
        `BT /F1 8.5 Tf ${cor[0]} ${cor[1]} ${cor[2]} rg 1 0 0 1 ${this.margem} ${base} Tm ` +
          `(${escapar(this.rodape)}) Tj ET`,
        `BT /F1 8.5 Tf ${cor[0]} ${cor[1]} ${cor[2]} rg 1 0 0 1 ` +
          `${(PDF.LARGURA - this.margem - larguraPagina).toFixed(2)} ${base} Tm ` +
          `(${escapar(pagina)}) Tj ET`,
      ].join("\n");
    });
  }

  /** Fecha o documento e devolve os bytes do arquivo. */
  bytes(): Uint8Array {
    if (this.buffer.length) this.novaPagina();
    if (!this.paginas.length) this.paginas.push("");
    this.desenharRodapes();

    const objetos: string[] = [];
    const add = (corpo: string) => objetos.push(corpo); // índice + 1 = número do objeto

    const nPaginas = this.paginas.length;
    // 1 Catalog, 2 Pages, 3 F1, 4 F2, 5 Info, depois (Page, Contents) por página.
    const idPagina = (i: number) => 6 + i * 2;
    const idConteudo = (i: number) => 7 + i * 2;

    add(`<</Type/Catalog/Pages 2 0 R>>`);
    add(
      `<</Type/Pages/Kids[${this.paginas
        .map((_, i) => `${idPagina(i)} 0 R`)
        .join(" ")}]/Count ${nPaginas}>>`
    );
    add(`<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>`);
    add(`<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>`);
    add(
      `<</Title(${escapar(this.titulo)})/Producer(${escapar("Radar Politico")})` +
      `/CreationDate(${dataPdf(new Date())})>>`
    );
    this.paginas.forEach((conteudo, i) => {
      add(
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PDF.LARGURA} ${PDF.ALTURA}]` +
        `/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${idConteudo(i)} 0 R>>`
      );
      add(`<</Length ${conteudo.length}>>\nstream\n${conteudo}\nendstream`);
    });

    let arquivo = "%PDF-1.4\n";
    const offsets: number[] = [];
    objetos.forEach((corpo, i) => {
      offsets.push(arquivo.length);
      arquivo += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
    });
    const inicioXref = arquivo.length;
    arquivo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      arquivo += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    arquivo +=
      `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R/Info 5 0 R>>\n` +
      `startxref\n${inicioXref}\n%%EOF`;

    const bytes = new Uint8Array(arquivo.length);
    for (let i = 0; i < arquivo.length; i++) bytes[i] = arquivo.charCodeAt(i) & 0xff;
    return bytes;
  }

  blob(): Blob {
    // BlobPart tipado: o buffer do Uint8Array é o que o Blob aceita em todas as
    // versões de lib.dom (ArrayBufferLike vs ArrayBuffer).
    return new Blob([this.bytes().slice().buffer], { type: "application/pdf" });
  }
}

/** Data no formato do PDF: D:YYYYMMDDHHmmSS. */
function dataPdf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
