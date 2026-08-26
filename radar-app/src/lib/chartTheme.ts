import type { Theme } from "@/stores/theme";

/** Cores de eixo/grid/tooltip/gauge por tema — todas com contraste AA.
 *
 *  Família QUENTE desde 11/08/26: os valores anteriores eram o slate azulado
 *  de antes do redesign de 03/08 (#475569/#CBD5E1, tooltip branco puro sobre
 *  azul-marinho), e dentro do card creme o gráfico parecia de outro produto —
 *  o mesmo defeito que trocou o mesh escuro de índigo para laranja. Agora o
 *  eixo é a própria tinta txt2 do tema e grade/trilho/tooltip vêm da família
 *  creme/chumbo do index.css e, em 26/08, para a família FRIA da paleta da
 *  marca — o gráfico segue a página, senão vira recorte de outro produto (o
 *  mesmo argumento que o tirou do slate azulado em 03/08). Medido: eixo claro
 *  #3E5B66 6,87:1 no card e 6,62:1 na página; eixo escuro #A9C0C6 7,64:1;
 *  texto de tooltip 14,52:1
 *  (claro) e 15,24:1 (escuro). */
export function chartInk(theme: Theme) {
  const light = theme === "light";
  return {
    axis: light ? "#3E5B66" : "#A9C0C6",       // labels dos eixos + legenda (= txt2 do tema)
    axisLine: light ? "#CFDDE0" : "#23414C",
    grid: light ? "#E1EBED" : "#183541",        // linhas de grade
    tooltipBg: light ? "#FDFEFE" : "#0C3240",   // a cor do card do tema, não branco puro
    tooltipBorder: light ? "#CFDDE0" : "#23414C",
    tooltipText: light ? "#04242F" : "#EAF2F3",
    detail: light ? "#04242F" : "#EAF2F3",       // número central do gauge
    track: light ? "#E1EBED" : "#1B3A46",        // trilho do gauge
    title: light ? "#3E5B66" : "#A9C0C6",
  };
}

/** Paleta de séries — espectro completo, harmônico, liderando pelo laranja.
 *  Hues distribuídos no círculo cromático com saturação/luminância parelhas
 *  para destacar cada série sem poluir visualmente. */
export const SERIES_PALETTE = [
  "#F97316", // laranja (marca)
  "#FBBF24", // âmbar / amarelo
  "#84CC16", // lima-verde
  "#10B981", // esmeralda
  "#06B6D4", // ciano
  "#6366F1", // índigo
  "#A855F7", // violeta
  "#EC4899", // rosa
];

/** Cor da linha ICA (violeta acessível por tema). */
export function violetLine(theme: Theme) {
  return theme === "light" ? "#7C3AED" : "#A78BFA";
}

// ── ACABAMENTO DE VIDRO (glassmorphism nos próprios dados) ──────────────
// O cartão já é vidro (index.css). Aqui damos gradiente translúcido + glow
// às barras/linhas, mantendo a cor SATURADA o suficiente para cada resultado
// ficar nítido (distinção de cor > transparência exagerada).

/** Converte #RRGGBB em rgba() com alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Gradiente linear de vidro (extremo saturado → translúcido). */
export function glassGradient(
  color: string,
  opts: { horizontal?: boolean; from?: number; to?: number } = {}
) {
  const { horizontal = false, from = 0.95, to = 0.4 } = opts;
  const coords = horizontal
    ? { x: 0, y: 0, x2: 1, y2: 0 }
    : { x: 0, y: 0, x2: 0, y2: 1 };
  return {
    type: "linear" as const,
    ...coords,
    colorStops: [
      { offset: 0, color: withAlpha(color, from) },
      { offset: 1, color: withAlpha(color, to) },
    ],
  };
}

/** itemStyle de barra com vidro: gradiente + cantos + glow na própria cor. */
export function glassBar(
  color: string,
  opts: { horizontal?: boolean; radius?: number | number[] } = {}
) {
  const { horizontal = false, radius = horizontal ? [0, 6, 6, 0] : [6, 6, 2, 2] } = opts;
  return {
    color: glassGradient(color, { horizontal }),
    borderRadius: radius,
    borderColor: withAlpha("#FFFFFF", 0.18),
    borderWidth: 1,
    shadowBlur: 12,
    shadowColor: withAlpha(color, 0.45),
  };
}

/** areaStyle translúcido para gráficos de linha. */
export function glassArea(color: string) {
  return { color: glassGradient(color, { from: 0.3, to: 0.02 }) };
}

/** lineStyle com glow suave na cor da série. */
export function glowLine(color: string, width = 3) {
  return { width, color, shadowBlur: 10, shadowColor: withAlpha(color, 0.5) };
}

/** Tokens semânticos de sentimento — fonte única de verdade. O neutro é cinza
 *  QUENTE (era o azulado #9FB0CC, com luminância ~0,43; #ABA598 mantém a mesma
 *  luminância para o peso das séries não mudar, só a temperatura). */
export const COLOR_SENTIMENT = {
  pos:      "#22C55E",
  neg:      "#EF4444",
  neu:      "#9EAFB4",
  atenção:  "#EAB308",
  alto:     "#F97316",
  critico:  "#EF4444",
} as const;

/** Cor semafórica do IAD (verde/amarelo/vermelho). */
export function colorByIAD(iad: number): string {
  if (iad >= 60) return COLOR_SENTIMENT.pos;
  if (iad >= 40) return COLOR_SENTIMENT.atenção;
  return COLOR_SENTIMENT.neg;
}
