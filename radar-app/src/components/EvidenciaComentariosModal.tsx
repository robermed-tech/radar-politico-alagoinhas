import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchComentariosPorTema } from "@/lib/data";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  ComentarioChip,
  tintaSentimento,
} from "@/components/ComentarioBox";
import { COLOR_SENTIMENT } from "@/lib/chartTheme";

interface Props {
  /** Categoria fixa (comments.tema) — ex.: "saude", "obras". Vem de
   * alertas[].tema_categoria no briefing (ver agora.py::_gerar_briefing). */
  tema: string;
  /** Texto original do alerta, só pra exibir no título do modal. */
  tituloTema: string;
  /** URLs dos posts do período selecionado no ClimaPage — filtra os
   * comentários por join (comments.url_post), não por data_comentario_ts
   * (esse campo é de um backfill parcial, só ~8% das linhas têm; ver
   * lib/data.ts::fetchComentariosPorTema). */
  urlsNoPeriodo: Set<string>;
  onClose: () => void;
}

/**
 * Evidência concreta por trás de um item de "Temas que merecem atenção":
 * lista os comentários reais (texto, autor, curtidas) que embasaram a
 * conclusão da IA, filtrados pela mesma categoria e período do alerta.
 * Mesmo padrão de portal usado em components/AlertaCrise.tsx.
 */
export function EvidenciaComentariosModal({ tema, tituloTema, urlsNoPeriodo, onClose }: Props) {
  const { data: todosComentarios, isLoading } = useQuery({
    queryKey: ["comentarios-tema", tema],
    queryFn: () => fetchComentariosPorTema(tema),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const comentarios = useMemo(
    () => (todosComentarios ?? []).filter((c) => urlsNoPeriodo.has(c.urlPost)),
    [todosComentarios, urlsNoPeriodo]
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
            <div className="font-extrabold text-txt-1">Comentários sobre este tema</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[14px] text-txt-3">
              <span>{tituloTema}</span>
              {comentarios.length > 0 && (
                <span className="tnum flex items-center gap-2 text-[13px] font-bold">
                  <span style={{ color: COLOR_SENTIMENT.neg }}>
                    {comentarios.filter((c) => c.sentimento === "negativo").length} neg
                  </span>
                  <span style={{ color: COLOR_SENTIMENT.pos }}>
                    {comentarios.filter((c) => c.sentimento === "positivo").length} pos
                  </span>
                </span>
              )}
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
          {isLoading && <p className="text-sm text-txt-3">Carregando comentários…</p>}

          {!isLoading && (comentarios?.length ?? 0) === 0 && (
            <p className="text-sm text-txt-3">
              Nenhum comentário específico deste tema no período — o alerta se baseia no
              conjunto geral de posts.
            </p>
          )}

          {/* Cards escuros desde a reunião de 24/07 (o cinza-sobre-cinza não
              tinha contraste); desde 29/07 é o ComentarioBox comum a todo o
              painel, com o degradê do radar de coleta. */}
          {comentarios?.map((c, i) => (
            <ComentarioBox key={i}>
              {/* Comentário maior e mais pesado (pedido de 27/07). */}
              <ComentarioTexto>{c.texto}</ComentarioTexto>
              <ComentarioMeta>
                {c.autor && <span>@{c.autor}</span>}
                <span className="tnum">{c.curtidas} curtida{c.curtidas === 1 ? "" : "s"}</span>
                <ComentarioChip cor={tintaSentimento(c.sentimento)}>{c.sentimento}</ComentarioChip>
              </ComentarioMeta>
            </ComentarioBox>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
