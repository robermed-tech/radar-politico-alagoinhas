import { useState } from "react";
import { signInWithPassword, sendPasswordSetupEmail } from "@/lib/auth";

const svgProps = {
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const FEATURES = [
  {
    icon: (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      </svg>
    ),
    titulo: "Clima Político", desc: "Termômetro visual da opinião pública",
  },
  {
    icon: (
      <svg {...svgProps}>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
    titulo: "Alertas & Ações", desc: "O que precisa de atenção hoje",
  },
  {
    icon: (
      <svg {...svgProps}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    titulo: "O que o povo diz", desc: "Vozes ouvidas nas redes, em tempo real",
  },
];

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviandoSenha, setEnviandoSenha] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    setAviso(null);
    const result = await signInWithPassword(email.trim(), password);
    setLoading(false);
    // Em caso de sucesso, o AuthProvider atualiza a sessão e a guarda
    // de rota troca para o dashboard automaticamente.
    if (result.error) setError(result.error);
  }

  // Primeiro acesso / senha esquecida: envia link para definir a senha.
  async function handleDefinirSenha() {
    setError(null);
    setAviso(null);
    if (!email.trim()) {
      return setError("Digite seu e-mail acima para receber o link.");
    }
    setEnviandoSenha(true);
    const { error } = await sendPasswordSetupEmail(email);
    setEnviandoSenha(false);
    if (error) return setError(error);
    setAviso(
      "Se este e-mail estiver cadastrado, enviamos um link para você definir a senha. Verifique sua caixa de entrada (e o spam)."
    );
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2" style={{ background: "var(--wx-bg)" }}>
      {/* ── PAINEL DE MARCA (esquerda) — estilo clean da referência ── */}
      <div className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col">
        <div
          className="absolute inset-4 rounded-[32px]"
          style={{
            background: `linear-gradient(150deg, rgba(251,146,60,0.92) 0%, rgba(234,88,12,0.95) 100%), url("/sky/sunny.webp") center/cover no-repeat`,
            boxShadow: "0 30px 70px -24px rgba(234,88,12,0.55)",
          }}
        />
        {/* bolhas decorativas */}
        <div className="pointer-events-none absolute -left-6 bottom-10 h-48 w-48 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }} />
        <div className="pointer-events-none absolute right-16 top-16 h-28 w-28 rounded-full" style={{ background: "rgba(190,219,29,0.25)" }} />

        <div className="reveal reveal-1 relative z-10 flex h-full flex-col p-8 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-xl font-bold backdrop-blur">
              ◉
            </span>
            <div>
              <div className="text-xl font-extrabold tracking-tight">Radar Político</div>
              <div className="text-sm text-white/80">Inteligência municipal</div>
            </div>
          </div>

          <div className="mt-auto">
            <h1 className="max-w-md text-[52px] font-extrabold leading-[1.05] tracking-tight">
              A opinião da cidade, em tempo real.
            </h1>
            <p className="mt-4 max-w-sm text-lg font-medium text-white/85">
              Acompanhe o clima político, antecipe crises e saiba o que a população
              comenta — tudo num só painel.
            </p>

            <div className="mt-8 space-y-3">
              {FEATURES.map((f) => (
                <div key={f.titulo} className="flex items-center gap-3 rounded-2xl bg-white/12 px-4 py-3 backdrop-blur">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">{f.icon}</span>
                  <div>
                    <div className="text-base font-bold leading-tight">{f.titulo}</div>
                    <div className="text-sm text-white/80">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── FORMULÁRIO (direita) ── */}
      <div className="grid place-items-center p-6">
        <div className="w-full max-w-sm">
          {/* logo compacta — visível também no mobile */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span
              className="grid h-10 w-10 place-items-center rounded-2xl text-xl font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              ◉
            </span>
            <div>
              <div className="font-extrabold tracking-tight">Radar Político</div>
              <div className="text-xs text-txt-3">Inteligência municipal</div>
            </div>
          </div>

          <div className="reveal reveal-2 rounded-[28px] border border-line bg-bg-1 p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-[30px] font-extrabold leading-tight tracking-tight">Entrar</h2>
                <p className="mt-1.5 text-base text-txt-2">
                  Acesse com seu e-mail e senha institucionais.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-txt-3">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="secretario@prefeitura.ba.gov.br"
                  required
                  autoFocus
                  autoComplete="email"
                  className="w-full rounded-2xl border border-line bg-bg-2 px-4 py-3 text-base outline-none transition focus:border-skycard"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-txt-3">
                  Senha
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
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

              {aviso && (
                <p
                  className="rounded-2xl px-4 py-2.5 text-xs text-risk-low"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)" }}
                >
                  {aviso}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim() || !password}
                className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ background: "#0B1220" }}
              >
                {loading ? "Entrando…" : "Entrar"}
                {!loading && <span aria-hidden>→</span>}
              </button>
            </form>

            <button
              type="button"
              onClick={handleDefinirSenha}
              disabled={enviandoSenha}
              className="mt-4 w-full text-center text-sm font-semibold text-brand transition hover:underline disabled:opacity-50"
            >
              {enviandoSenha ? "Enviando link…" : "Primeiro acesso ou esqueci a senha — definir senha"}
            </button>

            <p className="mt-4 text-center text-xs text-txt-3">
              Acesso restrito a usuários cadastrados pela prefeitura.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
