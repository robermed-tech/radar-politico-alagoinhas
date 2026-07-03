export const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
export const fmtPct = (n: number) => `${Math.round(n)}%`;

/** "2026-07-03" -> "03/07/26" (padrão brasileiro dd/mm/aa) */
export function fmtDiaBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

export function delta(atual: number, anterior: number): { v: number; dir: "up" | "down" | "flat" } {
  const v = atual - anterior;
  return { v: Math.round(v), dir: v > 0.5 ? "up" : v < -0.5 ? "down" : "flat" };
}
