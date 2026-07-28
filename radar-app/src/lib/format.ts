export const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
export const fmtPct = (n: number) => `${Math.round(n)}%`;

/** "2026-07-03" -> "03/07" (padrão brasileiro dd/mm, sem ano) — eixos de gráfico. */
export function fmtDiaBR(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

/** "2026-07-28" -> "28/07/26" (dd/mm/aa, revisão de 27/07) — datas em prosa. */
export function fmtDataBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano.slice(2)}`;
}

// Preposições que ficam minúsculas no meio do nome do bairro ("Riacho da
// Guia", não "Riacho Da Guia") — mesma lista usada pela normalização de
// localidade no backend (ver agora.py::_LIGACAO_DE_LUGAR).
const PREPOSICAO_BAIRRO = new Set(["da", "de", "do", "das", "dos"]);

/**
 * "riacho_da_guia" -> "Riacho da Guia" (revisão de 27/07: o painel mostrava o
 * slug cru, com underscore, em vez do nome legível do bairro).
 *
 * O frontend só tem o slug (coluna `comments.localidade`), não a grafia
 * acentuada de `bairros.nome` — capitalizar por palavra é o melhor que dá
 * para fazer sem uma segunda consulta ao Supabase. "area_rural" vira "Area
 * Rural", sem o acento de "Área"; aceitável, e infinitamente mais legível que
 * o slug com underscore.
 */
export function labelBairro(slug: string): string {
  const s = (slug ?? "").trim();
  if (!s || s === "nao_identificado") return "Não identificado";
  return s
    .split("_")
    .filter(Boolean)
    .map((p, i) =>
      i > 0 && PREPOSICAO_BAIRRO.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join(" ");
}

export function delta(atual: number, anterior: number): { v: number; dir: "up" | "down" | "flat" } {
  const v = atual - anterior;
  return { v: Math.round(v), dir: v > 0.5 ? "up" : v < -0.5 ? "down" : "flat" };
}

/**
 * Sentence case: só a primeira letra em maiúscula, o resto preservado
 * (revisão de 25/07 — o `capitalize` do CSS deixava "Instagram E Facebook Da
 * Prefeitura", com preposições em maiúscula no meio da frase).
 * Siglas e nomes próprios já escritos em maiúscula no texto original são
 * preservados; só o início da frase é normalizado.
 */
export function fraseCapitalizada(texto: string): string {
  const t = (texto ?? "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
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
