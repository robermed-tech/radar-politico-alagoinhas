export const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
export const fmtPct = (n: number) => `${Math.round(n)}%`;

/** "2026-07-03" -> "03/07" (padrão brasileiro dd/mm, sem ano) */
export function fmtDiaBR(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

export function delta(atual: number, anterior: number): { v: number; dir: "up" | "down" | "flat" } {
  const v = atual - anterior;
  return { v: Math.round(v), dir: v > 0.5 ? "up" : v < -0.5 ? "down" : "flat" };
}

/**
 * Remove travessões dos textos gerados pela IA (decisão da reunião de 24/07:
 * nenhum travessão em texto exibido). Cobre textos antigos já gravados no
 * banco; os prompts novos do agora.py também proíbem o caractere na origem.
 */
export function limparTravessoes(texto: string): string {
  return texto
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, "-")
    .replace(/,\s*,/g, ",");
}
