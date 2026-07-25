import { createPortal } from "react-dom";
import { parseData, type Post } from "@/lib/data";
import { fmtInt } from "@/lib/format";

interface Props {
  posts: Post[];
  periodoLabel: string;
  onClose: () => void;
}

const SENT_COR: Record<string, string> = {
  positivo: "#22C55E",
  negativo: "#EF4444",
  neutro: "#8593AD",
};

function fmtData(dataStr: string): string {
  const d = parseData(dataStr);
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
}

/**
 * Lista das publicações analisadas no período, com link direto para cada post
 * no Instagram (decisão da reunião de 24/07: o box de engajamento é clicável e
 * abre as publicações — os comentários a pessoa vê no próprio post).
 */
export function PublicacoesModal({ posts, periodoLabel, onClose }: Props) {
  const ordenados = [...posts].sort(
    (a, b) => (parseData(b.data_post)?.getTime() ?? 0) - (parseData(a.data_post)?.getTime() ?? 0)
  );
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-bg-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-extrabold text-txt-1">Publicações analisadas</div>
            <div className="mt-0.5 text-[13px] text-txt-3">
              {ordenados.length} publicação{ordenados.length === 1 ? "" : "ões"} · {periodoLabel} · clique para abrir no Instagram
            </div>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-txt-3 transition hover:text-txt-1"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-2 overflow-y-auto">
          {ordenados.length === 0 && (
            <p className="text-sm text-txt-3">Nenhuma publicação no período selecionado.</p>
          )}
          {ordenados.map((p, i) => (
            <a
              key={p.url || i}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-line bg-bg-2 p-3 transition hover:border-brand"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm font-bold text-txt-1">@{p.autor}</span>
                {p.tema && p.tema !== "—" && (
                  <span className="shrink-0 rounded bg-bg-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-txt-3">
                    {p.tema}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-txt-3">{fmtData(p.data_post)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-txt-3">
                <span className="tnum">{fmtInt(p.comentarios_total || 0)} comentário{(p.comentarios_total || 0) === 1 ? "" : "s"}</span>
                <span className="tnum">{fmtInt(p.curtidas || 0)} curtida{(p.curtidas || 0) === 1 ? "" : "s"}</span>
                {p.sentimento_comentarios && (
                  <span
                    className="font-semibold uppercase"
                    style={{ color: SENT_COR[p.sentimento_comentarios] ?? SENT_COR.neutro }}
                  >
                    {p.sentimento_comentarios}
                  </span>
                )}
                <span className="ml-auto inline-flex items-center gap-1 font-semibold text-txt-2">
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
      </div>
    </div>,
    document.body
  );
}
