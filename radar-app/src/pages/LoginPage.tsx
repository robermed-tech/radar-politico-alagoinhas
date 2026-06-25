import { useState } from "react";
import { sendMagicLink } from "@/lib/auth";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    const result = await sendMagicLink(email.trim());
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6" style={{ background: "var(--wx-bg)" }}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg-1 p-8">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="grid h-10 w-10 place-items-center rounded-xl text-xl font-bold text-white"
            style={{ background: "#3B82F6" }}
          >
            ◉
          </span>
          <div>
            <div className="font-extrabold tracking-tight">Radar Político</div>
            <div className="text-xs text-txt-3">Inteligência municipal</div>
          </div>
        </div>

        {sent ? (
          <div className="rounded-xl border border-green-800 p-4 text-center" style={{ background: "rgba(22,163,74,0.08)" }}>
            <div className="mb-2 text-3xl">📧</div>
            <div className="font-bold text-txt-1">Link enviado!</div>
            <p className="mt-1 text-sm text-txt-2">
              Verifique <strong>{email}</strong>.
              O link expira em 15 minutos.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              className="mt-3 text-xs text-txt-3 underline hover:text-txt-2"
            >
              Usar outro email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h2 className="text-xl font-extrabold">Entrar</h2>
              <p className="mt-1 text-sm text-txt-2">
                Informe seu email institucional para receber o link de acesso.
              </p>
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="secretario@prefeitura.ba.gov.br"
              required
              autoFocus
              className="w-full rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-sm outline-none focus:border-brand"
            />
            {error && (
              <p
                className="rounded-lg px-3 py-2 text-xs text-risk-crit"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Enviando…" : "Receber link de acesso"}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-[10px] text-txt-3">
          Acesso restrito a usuários cadastrados pela prefeitura.
        </p>
      </div>
    </div>
  );
}
