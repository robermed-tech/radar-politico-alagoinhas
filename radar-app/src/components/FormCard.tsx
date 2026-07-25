/**
 * Card e banner de feedback usados nas telas de cadastro (Relevância, Fontes
 * e as abas da Configuração). Ficavam privados no AdminPage; foram extraídos
 * quando Relevância e Fontes viraram páginas próprias na barra lateral.
 */

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-txt-3">{title}</div>
      {children}
    </div>
  );
}

export function Feedback({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      className="rounded-lg px-3 py-2 text-xs font-semibold"
      style={
        msg.ok
          ? { background: "rgba(22,163,74,0.1)", color: "#16A34A" }
          : { background: "rgba(239,68,68,0.1)", color: "#EF4444" }
      }
    >
      {msg.text}
    </p>
  );
}
