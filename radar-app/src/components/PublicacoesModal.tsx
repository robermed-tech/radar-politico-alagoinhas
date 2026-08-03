import { parseData, type Post } from "@/lib/data";
import { fmtInt } from "@/lib/format";
import { ModalShell } from "@/components/ModalShell";

interface Props {
  posts: Post[];
  periodoLabel: string;
  onClose: () => void;
}

const SENT_COR: Record<string, string> = {
  positivo: "#4ADE80",
  negativo: "#F87171",
  neutro: "#A8B4CC",
};

// Escuro permanente (pedido de 27/07, mantido na casca única de 03/08): este
// box não acompanha o tema claro — o ModalShell já é fixo em azul-marinho nos
// dois temas, e os cards internos ficam na mesma família. Toda fonte aqui é
// bold e >= 12px (`peso-bold-total`).
const CARD = "rgba(3, 9, 22, 0.6)";
const BORDA_CARD = "rgba(148, 163, 184, 0.13)";
const TXT = "#FFFFFF";
const TXT_2 = "#C9D2E2";
const TXT_3 = "#9AA5B8";

function fmtData(dataStr: string): string {
  const d = parseData(dataStr);
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
}

/** Introdução curta da legenda do post — identifica a publicação de bater o
 * olho (revisão de 25/07). Cai no resumo da IA quando o post não tem legenda. */
function introLegenda(p: Post): string {
  const base = (p.caption || p.resumo || "").replace(/\s+/g, " ").trim();
  if (!base) return "";
  return base.length > 110 ? base.slice(0, 109).trimEnd() + "…" : base;
}

/**
 * Lista das publicações analisadas no período, com link direto para cada post
 * no Instagram (decisão da reunião de 24/07: o box de engajamento é clicável e
 * abre as publicações — os comentários a pessoa vê no próprio post).
 *
 * Revisão de 27/07: nenhuma fonte abaixo de 12px nem em peso regular (o
 * conjunto anterior ficava ilegível na TV do gabinete). Casca visual:
 * ModalShell (linha única de pop-up do painel, 03/08).
 */
export function PublicacoesModal({ posts, periodoLabel, onClose }: Props) {
  const ordenados = [...posts].sort(
    (a, b) => (parseData(b.data_post)?.getTime() ?? 0) - (parseData(a.data_post)?.getTime() ?? 0)
  );
  return (
    <ModalShell
      onFechar={onClose}
      chip="Engajamento no período"
      titulo="Publicações analisadas"
      subtitulo={
        // publicaç + ão/ões: a versão anterior concatenava o sufixo à
        // palavra inteira e imprimia "127 publicaçãoões".
        `${ordenados.length} publicaç${ordenados.length === 1 ? "ão" : "ões"} · ${periodoLabel} · clique para abrir no Instagram`
      }
      icone={
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      }
    >
      {/* `peso-bold-total` (index.css) é a exceção declarada à diretriz global
          de tipografia — escopada a este box desde 27/07. */}
      <div className="peso-bold-total space-y-2">
        {ordenados.length === 0 && (
          <p className="text-[14px] font-bold" style={{ color: TXT_3 }}>
            Nenhuma publicação no período selecionado.
          </p>
        )}
        {ordenados.map((p, i) => (
          <a
            key={p.url || i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl p-3 transition hover:border-brand"
            style={{ background: CARD, border: `1px solid ${BORDA_CARD}` }}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-[14px] font-extrabold" style={{ color: TXT }}>
                @{p.autor}
              </span>
              {p.tema && p.tema !== "—" && (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wide"
                  style={{ background: "rgba(148,163,184,0.14)", color: TXT_2 }}
                >
                  {p.tema}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[13px] font-bold" style={{ color: TXT_3 }}>
                {fmtData(p.data_post)}
              </span>
            </div>
            {introLegenda(p) && (
              <p className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-snug" style={{ color: TXT_2 }}>
                {introLegenda(p)}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] font-bold" style={{ color: TXT_3 }}>
              <span className="tnum">{fmtInt(p.comentarios_total || 0)} comentário{(p.comentarios_total || 0) === 1 ? "" : "s"}</span>
              <span className="tnum">{fmtInt(p.curtidas || 0)} curtida{(p.curtidas || 0) === 1 ? "" : "s"}</span>
              {p.sentimento_comentarios && (
                <span
                  className="font-extrabold uppercase"
                  style={{ color: SENT_COR[p.sentimento_comentarios] ?? SENT_COR.neutro }}
                >
                  {p.sentimento_comentarios}
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 font-extrabold" style={{ color: TXT_2 }}>
                Abrir post
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </span>
            </div>
          </a>
        ))}
      </div>
    </ModalShell>
  );
}
