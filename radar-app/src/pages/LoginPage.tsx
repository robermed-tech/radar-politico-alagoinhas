import { useState } from "react";
import { sendMagicLink } from "@/lib/auth";

const FEATURES = [
  { icon: "☀️", titulo: "Clima Político", desc: "Termômetro visual da opinião pública" },
  { icon: "🔔", titulo: "Alertas & Ações", desc: "O que precisa de atenção hoje" },
  { icon: "💬", titulo: "O que o povo diz", desc: "Vozes ouvidas nas redes, em tempo real" },
];

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
              <div className="text-lg font-extrabold tracking-tight">Radar Político</div>
              <div className="text-xs text-white/80">Inteligência municipal</div>
            </div>
          </div>

          <div className="mt-auto">
            <h1 className="max-w-md text-[40px] font-extrabold leading-[1.05] tracking-tight">
              A opinião da cidade, em tempo real.
            </h1>
            <p className="mt-4 max-w-sm text-base font-medium text-white/85">
              Acompanhe o clima político, antecipe crises e saiba o que a população
              comenta — tudo num só painel.
            </p>

            <div className="mt-8 space-y-3">
              {FEATURES.map((f) => (
                <div key={f.titulo} className="flex items-center gap-3 rounded-2xl bg-white/12 px-4 py-3 backdrop-blur">
                  <span className="text-xl">{f.icon}</span>
                  <div>
                    <div className="text-sm font-bold leading-tight">{f.titulo}</div>
                    <div className="text-xs text-white/80">{f.desc}</div>
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
              style={{ background: "linear-gradient(150deg, #FB923C, #EA580C)" }}
            >
              ◉
            </span>
            <div>
              <div className="font-extrabold tracking-tight">Radar Político</div>
              <div className="text-xs text-txt-3">Inteligência municipal</div>
            </div>
          </div>

          <div className="reveal reveal-2 rounded-[28px] border border-line bg-bg-1 p-8">
            {sent ? (
              <div className="text-center">
                <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-3xl" style={{ background: "rgba(249,115,22,0.12)" }}>
                  📧
                </div>
                <div className="text-lg font-extrabold text-txt-1">Link enviado!</div>
                <p className="mt-1.5 text-sm text-txt-2">
                  Verifique <strong className="text-txt-1">{email}</strong>. O link expira em 15 minutos.
                </p>
                <button
                  onClick={() => { setSent(false); setEmail(""); }}
                  className="mt-4 text-xs font-semibold text-txt-3 underline hover:text-txt-2"
                >
                  Usar outro email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">Entrar</h2>
                  <p className="mt-1.5 text-sm text-txt-2">
                    Informe seu email institucional para receber o link de acesso.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-txt-3">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="secretario@prefeitura.ba.gov.br"
                    required
                    autoFocus
                    className="w-full rounded-2xl border border-line bg-bg-2 px-4 py-3 text-sm outline-none transition focus:border-skycard"
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
                  disabled={loading || !email.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: "#0B1220" }}
                >
                  {loading ? "Enviando…" : "Receber link de acesso"}
                  {!loading && <span aria-hidden>→</span>}
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-xs text-txt-3">
              Acesso restrito a usuários cadastrados pela prefeitura.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
