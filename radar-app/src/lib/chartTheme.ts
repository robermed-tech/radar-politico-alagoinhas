import type { Theme } from "@/stores/theme";

/** Cores de eixo/grid/tooltip/gauge por tema — todas com contraste AA. */
export function chartInk(theme: Theme) {
  const light = theme === "light";
  return {
    axis: light ? "#475569" : "#AEBCD6",       // labels dos eixos + legenda (slate-600 / claro)
    axisLine: light ? "#CBD5E1" : "#3A4660",
    grid: light ? "#E2E8F0" : "#283447",        // linhas de grade
    tooltipBg: light ? "#FFFFFF" : "#1A2233",
    tooltipBorder: light ? "#CBD5E1" : "#3A4660",
    tooltipText: light ? "#0B1220" : "#EAF0FA",
    detail: light ? "#0B1220" : "#EAF0FA",       // número central do gauge
    track: light ? "#E2E8F0" : "#2A3650",        // trilho do gauge
    title: light ? "#475569" : "#AEBCD6",
  };
}

/** Paleta de séries — saturada o suficiente p/ ler em ambos os temas. */
export const SERIES_PALETTE = [
  "#2563EB", // azul
  "#16A34A", // verde
  "#D97706", // âmbar
  "#DC2626", // vermelho
  "#7C3AED", // violeta (acessível)
  "#0891B2", // ciano
  "#DB2777", // rosa
  "#65A30D", // lima
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
