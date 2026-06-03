export const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
export const fmtPct = (n: number) => `${Math.round(n)}%`;

export function delta(atual: number, anterior: number): { v: number; dir: "up" | "down" | "flat" } {
  const v = atual - anterior;
  return { v: Math.round(v), dir: v > 0.5 ? "up" : v < -0.5 ? "down" : "flat" };
}
