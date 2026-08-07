/**
 * Share of Voice — divisão da conversa entre gestão, oposição e imprensa.
 *
 * Responde à pergunta que o painel não respondia: "quem está dominando a
 * conversa?". O sentimento diz COMO se fala; esta conta diz QUEM origina o
 * volume. A fatia de cada lado é medida pela conversa GERADA (comentários nas
 * publicações daquele lado), não pelo número de posts: publicar muito e gerar
 * pouco é voz baixa, e é exatamente essa diferença que a tela mostra.
 *
 * Auditoria de 07/08 (comparação comentário a comentário contra a tabela
 * `comments` inteira, 3.572 linhas) que definiu as duas regras daqui:
 *
 * 1. **A fatia por agregado bate com a realidade** — SoV por `comentarios_total`
 *    diverge < 2,1 pontos da contagem comentário a comentário (43,9/29,8/26,2
 *    contra 41,9/29,3/28,7 na janela auditada). Agregado vale como fonte.
 * 2. **A reação negativa é "dos que tomam partido", nunca diluída.** A média
 *    de `pct_neg` ponderada por `comentarios_total` incluía posts SEM NENHUM
 *    comentário analisado (gravados como 0%), e a reação negativa da gestão
 *    caía de 43,5% para 14,4% — um número que mentia a favor do cliente. Aqui
 *    o peso são os VOTOS (pct_pos/pct_neg × total): post sem medição não puxa
 *    a média para lado nenhum. É a mesma linguagem do IAD ("dos comentários
 *    que tomam partido") e o mesmo piso (MIN_VOTOS_IAD) para exibir.
 */
import { parseData, type Post } from "./data";
import type { Source } from "./admin";
import { MIN_VOTOS_IAD } from "./indices";

export type Lado = "governo" | "oposicao" | "imprensa" | "outros";

export const LADO_LABEL: Record<Lado, string> = {
  governo: "Gestão",
  oposicao: "Oposição",
  imprensa: "Imprensa",
  outros: "Outros",
};

/**
 * Mapa autor -> lado a partir do cadastro de Fontes (o `filtro` que o próprio
 * cliente atribui a cada perfil). Fallback pela categoria do post para handle
 * fora do cadastro — perfil removido das Fontes continua tendo posts antigos
 * na base, e sumir com eles distorceria a fatia dos outros.
 */
export function mapaDeLados(fontes: Source[]): (p: Post) => Lado {
  const porHandle = new Map<string, Lado>();
  for (const f of fontes) {
    const filtro = (f.filtro || "").toLowerCase();
    if (filtro === "governo" || filtro === "oposicao" || filtro === "imprensa") {
      porHandle.set(f.handle.toLowerCase().replace(/^@/, ""), filtro);
    }
  }
  return (p: Post): Lado => {
    const direto = porHandle.get((p.autor || "").toLowerCase());
    if (direto) return direto;
    const cat = (p.categoria || "").toLowerCase();
    if (cat.includes("prefeit") || cat.includes("govern")) return "governo";
    if (cat.includes("oposi")) return "oposicao";
    if (cat.includes("imprensa") || cat.includes("mídia")) return "imprensa";
    return "outros";
  };
}

export interface LadoStats {
  lado: Lado;
  posts: number;
  /** Conversa gerada: soma de comentarios_total dos posts do lado. */
  coments: number;
  /** Fatia da conversa do período (0-100). */
  share: number;
  comentsPorPost: number;
  /** Votos = comentários que tomaram partido (pct_pos/neg × total). */
  votos: number;
  /** % de reação negativa entre os votos; null abaixo de MIN_VOTOS_IAD. */
  pctNeg: number | null;
  perfis: string[];
}

export interface SemanaSov {
  /** Rótulo "dd/mm a dd/mm". */
  rotulo: string;
  total: number;
  /** Share 0-100 por lado na semana. */
  share: Record<Lado, number>;
}

export interface RankPerfil {
  autor: string;
  lado: Lado;
  posts: number;
  coments: number;
  /** Fatia da conversa total do período (0-100). */
  share: number;
  votos: number;
  pctNeg: number | null;
}

export interface SovResultado {
  totalPosts: number;
  totalComents: number;
  lados: LadoStats[];
  /** Share da gestão na janela imediatamente anterior (mesma duração); null sem dado. */
  gestaoAnterior: number | null;
  semanas: SemanaSov[];
  ranking: RankPerfil[];
  /** % de reação negativa da conversa inteira (corte vertical do quadrante). */
  pctNegConversa: number | null;
}

const LADOS: Lado[] = ["governo", "oposicao", "imprensa", "outros"];

function votosDe(p: Post): { pos: number; neg: number } {
  const total = p.comentarios_total || 0;
  return {
    pos: ((p.comentarios_pct_pos || 0) / 100) * total,
    neg: ((p.comentarios_pct_neg || 0) / 100) * total,
  };
}

function agrupaLados(posts: Post[], ladoDe: (p: Post) => Lado): Map<Lado, {
  posts: number; coments: number; pos: number; neg: number; perfis: Set<string>;
}> {
  const m = new Map<Lado, { posts: number; coments: number; pos: number; neg: number; perfis: Set<string> }>();
  for (const lado of LADOS) m.set(lado, { posts: 0, coments: 0, pos: 0, neg: 0, perfis: new Set() });
  for (const p of posts) {
    const v = m.get(ladoDe(p))!;
    const { pos, neg } = votosDe(p);
    v.posts += 1;
    v.coments += p.comentarios_total || 0;
    v.pos += pos;
    v.neg += neg;
    if (p.autor) v.perfis.add(p.autor);
  }
  return m;
}

function pctNegDe(pos: number, neg: number): number | null {
  const votos = pos + neg;
  // O piso é o mesmo do IAD e pelo mesmo motivo: com N votos, um comentário
  // sozinho move o percentual em 100/N pontos.
  if (votos < MIN_VOTOS_IAD) return null;
  return (neg / votos) * 100;
}

/**
 * Calcula o Share of Voice de uma janela de `dias`, ancorada em HOJE (as
 * mesmas janelas do PeriodoFilter do resto do painel). `postsTodos` é a base
 * inteira — a evolução semanal e a janela anterior precisam do que veio antes.
 */
export function calcularSov(
  postsTodos: Post[],
  fontes: Source[],
  dias: number
): SovResultado {
  const ladoDe = mapaDeLados(fontes);

  const cutoffAtual = new Date();
  cutoffAtual.setDate(cutoffAtual.getDate() - dias);
  cutoffAtual.setHours(0, 0, 0, 0);
  const cutoffAnterior = new Date(cutoffAtual);
  cutoffAnterior.setDate(cutoffAnterior.getDate() - dias);

  const datados = postsTodos
    .map((p) => ({ p, d: parseData(p.data_post) }))
    .filter((x): x is { p: Post; d: Date } => x.d !== null);

  const atual = datados.filter((x) => x.d >= cutoffAtual).map((x) => x.p);
  const anterior = datados
    .filter((x) => x.d >= cutoffAnterior && x.d < cutoffAtual)
    .map((x) => x.p);

  const grupos = agrupaLados(atual, ladoDe);
  const totalComents = [...grupos.values()].reduce((s, v) => s + v.coments, 0);

  const lados: LadoStats[] = LADOS.map((lado) => {
    const v = grupos.get(lado)!;
    return {
      lado,
      posts: v.posts,
      coments: v.coments,
      share: totalComents > 0 ? (v.coments / totalComents) * 100 : 0,
      comentsPorPost: v.posts > 0 ? v.coments / v.posts : 0,
      votos: Math.round(v.pos + v.neg),
      pctNeg: pctNegDe(v.pos, v.neg),
      perfis: [...v.perfis].sort(),
    };
  }).filter((l) => l.lado !== "outros" || l.posts > 0);

  // Janela anterior: só a fatia da gestão, para o veredito dizer a direção.
  let gestaoAnterior: number | null = null;
  if (anterior.length > 0) {
    const gAnt = agrupaLados(anterior, ladoDe);
    const totAnt = [...gAnt.values()].reduce((s, v) => s + v.coments, 0);
    if (totAnt > 0) gestaoAnterior = (gAnt.get("governo")!.coments / totAnt) * 100;
  }

  // Evolução: 5 semanas ancoradas no post mais RECENTE da base, não em hoje —
  // com a coleta parada, semanas vazias no fim só esconderiam a curva. O
  // rótulo carrega as datas reais, e o banner de saúde já denuncia o atraso.
  const semanas: SemanaSov[] = [];
  if (datados.length > 0) {
    const fim = new Date(Math.max(...datados.map((x) => x.d.getTime())));
    fim.setHours(23, 59, 59, 999);
    for (let k = 4; k >= 0; k--) {
      const sFim = new Date(fim);
      sFim.setDate(sFim.getDate() - 7 * k);
      const sIni = new Date(sFim);
      sIni.setDate(sIni.getDate() - 6);
      sIni.setHours(0, 0, 0, 0);
      const daSemana = datados.filter((x) => x.d >= sIni && x.d <= sFim).map((x) => x.p);
      const g = agrupaLados(daSemana, ladoDe);
      const tot = [...g.values()].reduce((s, v) => s + v.coments, 0);
      const share = {} as Record<Lado, number>;
      for (const lado of LADOS) share[lado] = tot > 0 ? (g.get(lado)!.coments / tot) * 100 : 0;
      const fmt = (d: Date) =>
        `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      semanas.push({ rotulo: `${fmt(sIni)} a ${fmt(sFim)}`, total: tot, share });
    }
  }

  // Ranking de perfis por conversa gerada.
  const porPerfil = new Map<string, { lado: Lado; posts: number; coments: number; pos: number; neg: number }>();
  for (const p of atual) {
    const chave = p.autor || "—";
    const v = porPerfil.get(chave) ?? { lado: ladoDe(p), posts: 0, coments: 0, pos: 0, neg: 0 };
    const { pos, neg } = votosDe(p);
    v.posts += 1;
    v.coments += p.comentarios_total || 0;
    v.pos += pos;
    v.neg += neg;
    porPerfil.set(chave, v);
  }
  const ranking: RankPerfil[] = [...porPerfil.entries()]
    .map(([autor, v]) => ({
      autor,
      lado: v.lado,
      posts: v.posts,
      coments: v.coments,
      share: totalComents > 0 ? (v.coments / totalComents) * 100 : 0,
      votos: Math.round(v.pos + v.neg),
      pctNeg: pctNegDe(v.pos, v.neg),
    }))
    .sort((a, b) => b.coments - a.coments)
    .slice(0, 8);

  const posTotal = atual.reduce((s, p) => s + votosDe(p).pos, 0);
  const negTotal = atual.reduce((s, p) => s + votosDe(p).neg, 0);

  return {
    totalPosts: atual.length,
    totalComents,
    lados,
    gestaoAnterior,
    semanas,
    ranking,
    pctNegConversa: pctNegDe(posTotal, negTotal),
  };
}
