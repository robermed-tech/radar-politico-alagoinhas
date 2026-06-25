/**
 * Índices de inteligência política — implementação das fórmulas do blueprint.
 * IAD (Aprovação Digital), ICA (Confiança da Amostra), Risco Político.
 */
import { type Post, parseData } from "./data";

export type NivelCrise = "baixo" | "moderado" | "alto" | "critico";

export interface Indices {
  iad: number; // 0-100 aprovação digital
  ica: number; // 0-100 confiança da amostra
  risco: number; // 0-100 risco político
  nivel: NivelCrise;
  pctPos: number;
  pctNeg: number;
  pctNeu: number;
  volumePosts: number;
  volumeComents: number;
  tendencia: "subindo" | "estavel" | "caindo";
}

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v));

/**
 * IAD — Índice de Aprovação Digital (0-100).
 * Sentimento dos comentários ponderado por volume de comentários (proxy de
 * amplificação, já que o Sheets agrega % por post). Posts com mais comentários
 * pesam mais. Neutro conta 0.5.
 */
export function calcIAD(posts: Post[]): number {
  let sPos = 0;
  let sNeg = 0;
  let sNeu = 0;
  for (const p of posts) {
    const n = p.comentarios_total || 0;
    const peso = 1 + Math.log10(1 + n);
    const pPos = (p.comentarios_pct_pos || 0) / 100;
    const pNeg = (p.comentarios_pct_neg || 0) / 100;
    const pNeu = Math.max(0, 1 - pPos - pNeg);
    sPos += peso * pPos;
    sNeg += peso * pNeg;
    sNeu += peso * pNeu;
  }
  const tot = sPos + sNeg + sNeu;
  if (tot === 0) return 0;
  return clamp(0, 100, (100 * (sPos + 0.5 * sNeu)) / tot);
}

/**
 * ICA — Índice de Confiança da Amostra (0-100).
 * Combina volume, diversidade de fontes, recência e balanço.
 * Evita conclusões fortes (ex.: "Severíssimo") com amostra fraca.
 */
export function calcICA(posts: Post[]): number {
  if (posts.length === 0) return 0;
  const nComents = posts.reduce((s, p) => s + (p.comentarios_total || 0), 0);
  const Nref = 500;
  const fVolume = Math.min(1, Math.log10(1 + nComents) / Math.log10(1 + Nref));

  const perfis = new Set(posts.map((p) => p.autor)).size;
  const fFontes = Math.min(1, perfis / 8);

  const datas = posts.map((p) => parseData(p.data_post)).filter(Boolean) as Date[];
  const maisRecente = datas.length ? Math.max(...datas.map((d) => d.getTime())) : Date.now();
  const horas = (Date.now() - maisRecente) / 36e5;
  const fRecencia = Math.exp(-horas / 48);

  const tot = posts.length || 1;
  const pPos = (posts.filter((p) => p.sentimento_post === "positivo").length / tot) * 100;
  const pNeg = (posts.filter((p) => p.sentimento_post === "negativo").length / tot) * 100;
  const fBalanco = 1 - (Math.abs(pPos - pNeg) / 100) * 0.3;

  return clamp(
    0,
    100,
    100 * (0.45 * fVolume + 0.25 * fFontes + 0.2 * fRecencia + 0.1 * fBalanco)
  );
}

/** Distribuição de sentimento dos posts (%). */
export function distribuicao(posts: Post[]) {
  const tot = posts.length || 1;
  const pos = posts.filter((p) => p.sentimento_post === "positivo").length;
  const neg = posts.filter((p) => p.sentimento_post === "negativo").length;
  const neu = tot - pos - neg;
  return {
    pctPos: Math.round((pos / tot) * 100),
    pctNeg: Math.round((neg / tot) * 100),
    pctNeu: Math.round((neu / tot) * 100),
  };
}

/** Risco político 0-100 + nível de crise. */
export function calcRisco(
  posts: Post[],
  iad: number,
  ica: number,
  negVelocity = 0
): { risco: number; nivel: NivelCrise } {
  const tot = posts.length || 1;
  const pctRiscoAlto = (posts.filter((p) => p.risco_crise === "alto").length / tot) * 100;
  // Velocidade do negativo AMORTECIDA pela confiança (ICA): com amostra fraca,
  // um pico de % negativo num dia não dispara o risco (evita "Crítico" falso).
  const velTerm = Math.min(100, Math.max(0, negVelocity * 4)) * (ica / 100);
  const risco = clamp(
    0,
    100,
    0.35 * (100 - iad) +
      0.25 * pctRiscoAlto +
      0.2 * velTerm +
      0.15 * 0 + // amplificação negativa: Fase 2 (precisa de comentários granulares)
      0.05 * (100 - ica)
  );
  let nivel: NivelCrise = "baixo";
  if (risco >= 80) nivel = "critico";
  else if (risco >= 60) nivel = "alto";
  else if (risco >= 40) nivel = "moderado";
  // ICA baixo nunca escala para crítico (amostra insuficiente)
  if (ica < 40 && nivel === "critico") nivel = "alto";
  return { risco: Math.round(risco), nivel };
}

/** Calcula todos os índices de um conjunto de posts. */
export function calcIndices(posts: Post[], negVelocity = 0): Indices {
  const iad = calcIAD(posts);
  const ica = calcICA(posts);
  const { risco, nivel } = calcRisco(posts, iad, ica, negVelocity);
  const dist = distribuicao(posts);
  const tendencia: Indices["tendencia"] =
    negVelocity > 2 ? "caindo" : negVelocity < -2 ? "subindo" : "estavel";
  return {
    iad: Math.round(iad),
    ica: Math.round(ica),
    risco,
    nivel,
    ...dist,
    volumePosts: posts.length,
    volumeComents: posts.reduce((s, p) => s + (p.comentarios_total || 0), 0),
    tendencia,
  };
}

export const NIVEL_LABEL: Record<NivelCrise, string> = {
  baixo: "Baixo",
  moderado: "Moderado",
  alto: "Alto",
  critico: "Crítico",
};

export const NIVEL_COLOR: Record<NivelCrise, string> = {
  baixo: "#22C55E",
  moderado: "#EAB308",
  alto: "#F97316",
  critico: "#EF4444",
};
