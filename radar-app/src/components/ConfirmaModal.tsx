/**
 * Confirmação de ação destrutiva — substitui o `window.confirm` nativo, que
 * era o único pop-up fora da linha visual do painel (03/08).
 *
 * O botão de confirmar segue a receita de cor SEMÂNTICA dos cards de extremo:
 * degradê claro na família do vermelho com texto quase preto por cima, nunca
 * fundo escuro com texto claro. Cancelar é o botão neutro de vidro.
 */
import { ModalShell } from "@/components/ModalShell";

interface Props {
  titulo: string;
  /** Consequência da ação, dita de frente (ex.: o que se perde e o que fica). */
  mensagem: React.ReactNode;
  rotuloConfirmar?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmaModal({
  titulo, mensagem, rotuloConfirmar = "Remover", onConfirmar, onCancelar,
}: Props) {
  return (
    <ModalShell
      onFechar={onCancelar}
      larguraMax="max-w-md"
      chip="Confirmação"
      titulo={titulo}
      corIcone="#F87171"
      icone={
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      }
      rodape={
        <>
          <button
            onClick={onCancelar}
            className="rounded-xl border border-line bg-bg-2 px-4 py-2.5 text-sm font-semibold text-txt-1 transition hover:bg-bg-3"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="cursor-pointer rounded-xl px-5 py-2.5 text-sm font-extrabold transition hover:opacity-90"
            style={{
              background: "linear-gradient(150deg, #FCA5A5 0%, #EF4444 100%)",
              color: "#1A0F02",
            }}
          >
            {rotuloConfirmar}
          </button>
        </>
      }
    >
      <p className="text-[15px] leading-relaxed text-txt-2">{mensagem}</p>
    </ModalShell>
  );
}
