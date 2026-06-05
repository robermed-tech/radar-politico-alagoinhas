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
