/**
 * Cor fixa por tema/assunto (Cultura, Saúde, Obras…) — fonte única de
 * verdade reusada em qualquer lugar que rotule um post/pedido por tema:
 * chip do feed (PostChips), filtro e tag do card em Pedidos do Povo.
 * Reaproveita os hues de SERIES_PALETTE (chartTheme.ts) + vermelho/azul/slate
 * já em uso no resto do app, em vez de inventar uma paleta nova.
 */
const TEMA_COLOR: Record<string, string> = {
  obras: "#F97316", // laranja (marca)
  saude: "#EC4899", // rosa
  educacao: "#6366F1", // índigo
  saneamento: "#06B6D4", // ciano
  seguranca: "#EF4444", // vermelho
  transporte: "#3B82F6", // azul
  emprego: "#10B981", // esmeralda
  impostos: "#A855F7", // violeta
  cultura: "#FBBF24", // âmbar
  cultura_eventos: "#FBBF24",
  comunicacao: "#84CC16", // lima-verde
  outro: "#64748B", // slate neutro
  outros: "#64748B",
};

const FALLBACK = "#64748B";

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Cor determinística para um tema — mapeada quando conhecido, hash estável quando não. */
export function corTema(tema?: string | null): string {
  if (!tema) return FALLBACK;
  const key = normalizar(tema);
  if (TEMA_COLOR[key]) return TEMA_COLOR[key];
  const paleta = Object.values(TEMA_COLOR);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return paleta[hash % paleta.length];
}
