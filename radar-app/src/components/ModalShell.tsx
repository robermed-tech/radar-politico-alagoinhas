/**
 * ModalShell — a casca única de TODO pop-up do painel.
 *
 * Linha visual (revisão de 03/08, referência aprovada pelo cliente): caixa em
 * azul-marinho profundo com fio de luz na aresta superior, tile de ícone à
 * esquerda, chip de contexto em caixa alta, título grande, painéis internos um
 * degrau mais escuros e botão primário em pílula clara. Fixa nos DOIS temas:
 * pop-up é momento de foco e não acompanha o tema da página (mesmo princípio
 * do box "Publicações analisadas").
 *
 * Como fica igual em todo lugar: os quatro modais do painel usam ESTE
 * componente — duas cópias divergiriam no primeiro ajuste (a mesma razão que
 * extraiu o EnvioSecretario do AlertaCrise). A casca aplica `theme-dark` na
 * própria subárvore, então o conteúdo interno que usa tokens (ComentarioBox,
 * bordas, tintas de sentimento) resolve nos valores escuros já auditados de
 * contraste, mesmo com a página no tema claro.
 *
 * Acessibilidade embutida (uma vez, aqui, para todos): role="dialog" +
 * aria-modal + aria-labelledby, Esc fecha, clique no fundo fecha, rolagem da
 * página travada enquanto aberto e foco inicial na caixa.
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalShellProps {
  onFechar: () => void;
  /** Contexto curto em caixa alta acima do título (ex.: "Mapa da cidade"). */
  chip?: string;
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  /** SVG do tile à esquerda do cabeçalho. */
  icone?: React.ReactNode;
  /** Tinge o tile do ícone (fundo translúcido derivado). Default: ardósia. */
  corIcone?: string;
  /** Ações do rodapé, alinhadas à direita (ex.: <ModalBotaoPrimario/>). */
  rodape?: React.ReactNode;
  /** Classe de largura máxima da caixa. */
  larguraMax?: string;
  children: React.ReactNode;
}

export function ModalShell({
  onFechar, chip, titulo, subtitulo, icone, corIcone, rodape,
  larguraMax = "max-w-lg", children,
}: ModalShellProps) {
  const tituloId = useId();
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onFechar(); return; }
      // Tab preso dentro do modal. Sem isso, o Tab passa do último botão do
      // pop-up para os controles da PÁGINA atrás dele — que está coberta pelo
      // véu e é justamente o que o modal pediu para o usuário ignorar. Quem
      // navega por teclado perdia o foco de vista e não tinha como voltar.
      if (e.key !== "Tab") return;
      const caixa = caixaRef.current;
      if (!caixa) return;
      const focaveis = Array.from(
        caixa.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focaveis.length === 0) { e.preventDefault(); return; }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const atual = document.activeElement;
      // O foco começa na própria caixa (tabindex -1), que não está na lista:
      // nesse estado o Shift+Tab tem que ir para o ÚLTIMO, e não escapar.
      if (!e.shiftKey && (atual === ultimo || !caixa.contains(atual))) {
        e.preventDefault();
        primeiro.focus();
      } else if (e.shiftKey && (atual === primeiro || atual === caixa)) {
        e.preventDefault();
        ultimo.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    // Trava a rolagem da página atrás do modal (e devolve o valor anterior ao
    // fechar, para não pisar num overflow customizado de outra camada).
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Quem abriu o modal recebe o foco de volta ao fechar — senão o usuário de
    // teclado volta para o topo do documento e precisa refazer o caminho até o
    // botão que acabou de acionar.
    const origem = document.activeElement as HTMLElement | null;
    caixaRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = anterior;
      if (origem?.isConnected) origem.focus();
    };
  }, [onFechar]);

  return createPortal(
    <div
      className="modal-fundo fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      {/* `theme-dark` força os tokens do tema escuro na subárvore inteira. */}
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={`modal-caixa theme-dark flex max-h-[90vh] w-full ${larguraMax} flex-col rounded-3xl p-6 outline-none`}
      >
        {/* Cabeçalho */}
        <div className="flex items-start gap-4">
          {icone && (
            <div
              className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl"
              style={{
                background: corIcone ? `${corIcone}24` : "rgba(148,163,184,0.10)",
                border: `1px solid ${corIcone ? `${corIcone}47` : "rgba(148,163,184,0.22)"}`,
                color: corIcone ?? "#C2D6DB",
              }}
            >
              {icone}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {chip && (
              <span
                className="frase-cap inline-block rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-[0.08em]"
                style={{ background: "rgba(148,163,184,0.14)", color: "#D7E0F0" }}
              >
                {chip}
              </span>
            )}
            <h2
              id={tituloId}
              className={`truncate text-[24px] font-extrabold leading-tight tracking-tight text-txt-1 ${chip ? "mt-2" : ""}`}
            >
              {titulo}
            </h2>
            {subtitulo && (
              <p className="mt-1 text-[15px] font-medium text-txt-3">{subtitulo}</p>
            )}
          </div>
          <button
            onClick={onFechar}
            className="shrink-0 cursor-pointer rounded-lg p-1 text-txt-3 transition hover:text-txt-1"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Corpo — rola sozinho; cabeçalho e rodapé ficam fixos. */}
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">{children}</div>

        {rodape && (
          <div className="mt-5 flex items-center justify-end gap-2">{rodape}</div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Painel interno do modal: um degrau mais escuro que a casca, como o corpo
 * de texto da referência. */
export function ModalPainel({
  children, className = "",
}: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`modal-painel rounded-2xl p-4 ${className}`}>{children}</div>
  );
}

/** Botão primário do modal: pílula clara com texto quase preto. */
export function ModalBotaoPrimario(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>
) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`modal-botao-primario cursor-pointer rounded-xl px-6 py-2.5 text-sm font-extrabold ${className}`}
    />
  );
}
