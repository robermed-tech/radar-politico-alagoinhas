import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchComentariosPorTema } from "@/lib/data";
import { ModalShell } from "@/components/ModalShell";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  ComentarioChip,
  tintaSentimento,
  TINTA_SENTIMENTO_POS,
  TINTA_SENTIMENTO_NEG,
} from "@/components/ComentarioBox";

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
 *
 * Casca visual: ModalShell (linha única de pop-up do painel, 03/08).
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

  const neg = comentarios.filter((c) => c.sentimento === "negativo").length;
  const pos = comentarios.filter((c) => c.sentimento === "positivo").length;

  return (
    <ModalShell
      onFechar={onClose}
      chip="Temas que merecem atenção"
      titulo="Comentários sobre este tema"
      subtitulo={
        <>
          {tituloTema}
          {comentarios.length > 0 && (
            <span className="tnum ml-2 inline-flex items-center gap-2 text-[13px] font-bold">
              <span style={{ color: TINTA_SENTIMENTO_NEG }}>{neg} neg</span>
              <span style={{ color: TINTA_SENTIMENTO_POS }}>{pos} pos</span>
            </span>
          )}
        </>
      }
      icone={
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      }
    >
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-txt-3">Carregando comentários…</p>}

        {!isLoading && (comentarios?.length ?? 0) === 0 && (
          <p className="text-sm text-txt-3">
            Nenhum comentário específico deste tema no período: o alerta se baseia no
            conjunto geral de posts.
          </p>
        )}

        {/* ComentarioBox comum a todo o painel (29/07); dentro do modal os
            tokens resolvem no tema escuro forçado pela casca. */}
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
    </ModalShell>
  );
}
