/**
 * Índices de inteligência política — implementação das fórmulas do blueprint.
 * IAD (Aprovação Digital), ICA (Confiança da Amostra), Risco Político.
 */
import { type Post, parseData } from "./data";
import type { ScoreWeights } from "./admin";

export type NivelCrise = "baixo" | "moderado" | "alto" | "critico";

/**
 * Pesos do score composto. São a fonte da verdade dos cálculos exibidos no
 * painel (IAD e Risco). Estes defaults espelham o seed de `tenant_settings`
 * (migration 002) — se a leitura do Supabase falhar, o painel continua com os
 * mesmos números de sempre. Quando o admin salva novos pesos na aba "Score",
 * `setScoreWeights` reescreve este módulo e os cálculos passam a usá-los.
 */
/* `risco_amplificacao` continua aqui por compatibilidade com o que já está
 * salvo em `tenant_settings`, mas NÃO entra no cálculo do risco enquanto o
 * dado de amplificação não for coletado (ver calcRisco). Mudar este valor não
 * altera nenhum número exibido. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  risco_iad: 0.35,
  risco_pct_alto: 0.25,
  risco_velocidade: 0.2,
  risco_amplificacao: 0.15,
  risco_ica: 0.05,
  iad_neutro: 0.5,
};

let activeWeights: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS };

/** Aplica pesos vindos de `tenant_settings` (campos ausentes caem no default). */
export function setScoreWeights(w: Partial<ScoreWeights> | null | undefined): void {
  activeWeights = { ...DEFAULT_SCORE_WEIGHTS, ...(w ?? {}) };
}

/** Pesos em vigor — usado pela UI para exibir/depurar o que está ativo. */
export function getScoreWeights(): ScoreWeights {
  return activeWeights;
}

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
  // iad_neutro = quanto um comentário neutro vale na aprovação (default 0.5).
  return clamp(0, 100, (100 * (sPos + activeWeights.iad_neutro * sNeu)) / tot);
}

/**
 * Piso de comentários COM VOTO (positivo ou negativo) para o IAD significar
 * alguma coisa. Abaixo disso a tela mostra "sem sinal", nunca o número.
 *
 * Por que o piso é necessário, e por que ele é 10: o IAD conta neutro com peso
 * `iad_neutro` (0,5). Post sem nenhum comentário classificado entra como 100%
 * neutro, e um período inteiro assim converge para EXATAMENTE 50 — que a tela
 * exibia como "Aprovação da gestão", com a legenda de aprovação embaixo e o
 * clima "Nublado — opiniões divididas" ao lado. Ou seja, o produto afirmava
 * empate onde não houve medição nenhuma. Medido na base em 05/08/26: 166 dos
 * 330 posts (50%) têm pct_pos e pct_neg zerados, e o índice bateu 50,0 exato
 * em 14 dos 55 dias com métrica.
 *
 * O piso não é 1 porque o problema não some com um voto só: com N votos, um
 * único comentário move o índice em 100/N pontos. Em N=10 ele vale 10 pontos,
 * que já é a largura de uma faixa de clima inteira; abaixo disso um comentário
 * sozinho troca a condição exibida, e o número não distingue mais nada.
 *
 * AO MEXER NESTE NÚMERO, medir antes contra a base, não escolher no olho:
 * quantos dias/posts passam a exibir IAD e quantos passam a dizer "sem sinal".
 * Piso alto demais esconde medição legítima; baixo demais devolve o número que
 * este piso existe para calar. Limiar se calibra contra a distribuição real.
 */
export const MIN_VOTOS_IAD = 10;

/**
 * Comentários que TOMARAM PARTIDO no período (estimativa a partir do agregado
 * por post, que é o que o painel tem: `comentarios_total` × % que se
 * posicionou). Neutro e indeterminado ficam de fora de propósito: eles entram
 * no IAD, mas não são evidência de que houve medição.
 */
export function votosDeSentimento(posts: Post[]): number {
  let votos = 0;
  for (const p of posts) {
    const n = p.comentarios_total || 0;
    const pct = (p.comentarios_pct_pos || 0) + (p.comentarios_pct_neg || 0);
    votos += (n * Math.min(100, pct)) / 100;
  }
  return Math.round(votos);
}

/** O IAD do período pode ser exibido como número? Ver MIN_VOTOS_IAD. */
export function temSinalIAD(posts: Post[]): boolean {
  return votosDeSentimento(posts) >= MIN_VOTOS_IAD;
}

/**
 * ICA — Índice de Confiança da Amostra (0-100).
 * Combina volume, diversidade de fontes, recência e balanço.
 * Evita conclusões fortes (ex.: "Extremo") com amostra fraca.
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

/**
 * Risco político 0-100 + nível de crise.
 *
 * NORMALIZADO pela soma dos pesos aplicados (auditoria de 26/07). Gêmeo exato
 * de `calc_risco()` no agora.py: mesmos termos, mesmos pesos, mesma
 * normalização. Antes o backend somava 3 termos (teto real 65) e o frontend
 * somava 4 termos úteis (teto real 85), então o mesmo dia tinha dois riscos
 * diferentes no mesmo produto, e nenhum dos dois alcançava a faixa "crítico"
 * que ambos declaravam ter.
 *
 * `risco_amplificacao` ficou fora do numerador E do denominador: era
 * multiplicado por zero desde sempre (dado não coletado). Mantê-lo no
 * denominador só recriaria o teto artificial. O campo continua no tipo por
 * compatibilidade com `tenant_settings`; quando o dado existir, ele volta
 * aqui e no agora.py juntos.
 */
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
  const w = activeWeights;
  const somaPesos = w.risco_iad + w.risco_pct_alto + w.risco_velocidade + w.risco_ica;
  const risco = clamp(
    0,
    100,
    (w.risco_iad * (100 - iad) +
      w.risco_pct_alto * pctRiscoAlto +
      w.risco_velocidade * velTerm +
      w.risco_ica * (100 - ica)) /
      (somaPesos || 1)
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

export interface Delta {
  iad: number;
  pctPos: number;
  pctNeg: number;
}

export function calcDelta(atual: Indices, anterior: Indices): Delta {
  return {
    iad: atual.iad - anterior.iad,
    pctPos: atual.pctPos - anterior.pctPos,
    pctNeg: atual.pctNeg - anterior.pctNeg,
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
  alto: "#EF8C00",
  critico: "#EF4444",
};

/**
 * Badge "com volume": preenchimento sólido em degradê + brilho colorido +
 * friso de luz no topo — mesmo tratamento do botão ativo do menu lateral
 * (NAV_GLOW em App.tsx), generalizado pra qualquer cor de nível. Fonte
 * única para o "box de análise do clima" (ClimaPage) e qualquer outra tela
 * que precise do mesmo selo de nível de atenção (ex: Alertas & Ações).
 *
 * Texto sempre em preto quente: nas 4 cores de NIVEL_COLOR (verde, amarelo,
 * laranja, vermelho), preto passa contraste AA/AAA em todas — branco falha
 * ou fica no limite em todas.
 */
export function nivelBadgeStyle(cor: string) {
  return {
    background: `linear-gradient(180deg, ${cor}E6 0%, ${cor} 100%)`,
    color: "#04242F",
    boxShadow: `0 3px 12px -3px ${cor}80, inset 0 1px 0 rgba(255,255,255,0.4)`,
  };
}
