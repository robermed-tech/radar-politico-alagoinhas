import { useState } from "react";
import { supabase } from "@/lib/auth";

/**
 * Tela exibida quando o usuário chega pelo link de convite (e-mail enviado
 * pelo Supabase). Ele já está autenticado pelo token do convite, mas ainda
 * não tem senha — definir a senha aqui é a confirmação de recebimento do
 * convite, e só depois disso ele segue para o painel normal.
 */
export function AceitarConvitePage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      return setError("A senha precisa ter pelo menos 6 caracteres.");
    }
    if (password !== confirmPassword) {
      return setError("As senhas não coincidem.");
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <div className="grid min-h-screen place-items-center p-6" style={{ background: "var(--wx-bg)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span
            className="grid h-10 w-10 place-items-center rounded-2xl text-xl font-bold text-white"
            style={{ background: "var(--brand)", color: "#1A0F02" }}
          >
            ◉
          </span>
          <div>
            <div className="font-extrabold tracking-tight">Radar Político</div>
            <div className="text-xs text-txt-3">Inteligência municipal</div>
          </div>
        </div>

        <div className="rounded-[28px] border border-line bg-bg-1 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">
                Bem-vindo(a) ao Radar Político
              </h2>
              <p className="mt-1.5 text-base text-txt-2">
                Defina sua senha para concluir o cadastro e continuar.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-txt-3">
                Nova senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus
                autoComplete="new-password"
                className="w-full rounded-2xl border border-line bg-bg-2 px-4 py-3 text-base outline-none transition focus:border-skycard"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-txt-3">
                Confirmar senha
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                className="w-full rounded-2xl border border-line bg-bg-2 px-4 py-3 text-base outline-none transition focus:border-skycard"
              />
            </div>

            {error && (
              <p
                className="rounded-2xl px-4 py-2.5 text-xs text-risk-crit"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-bold text-brand-ink transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--brand)", boxShadow: "0 8px 20px rgba(247,150,65,0.35)" }}
            >
              {loading ? "Salvando…" : "Definir senha e entrar"}
              {!loading && <span aria-hidden>→</span>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
