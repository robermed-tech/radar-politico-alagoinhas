import { useState } from "react";
import { signInWithPassword, sendPasswordSetupEmail } from "@/lib/auth";
import { WordmarkViratempo } from "@/components/LogoViratempo";

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
        {/* Prévia 3 de 04/08: o painel de marca troca o degradê laranja sobre
            foto (e o círculo verde-lima de uma identidade passada) pelo chumbo
            escuro do painel com o SOL da marca flutuando — a mesma cena que
            recebe o usuário na Estação Meteorológica logo depois do login. */}
        <div
          className="absolute inset-4 rounded-[32px]"
          style={{
            // PETRÓLEO CHAPADO desde 27/08 (edição do Robério no canvas do
            // Login): era o degradê `FUNDO_ESCUTA`, importado de
            // superficieRadio.ts. O painel deixou de compartilhar a superfície
            // dos cards escuros do painel de dados de propósito — aqui o fundo
            // é uma chapada da cor da marca, e a única coisa que acontece sobre
            // ela é o sol. Os cards internos da Rádio Escuta, o radar e a
            // antena seguem no degradê; não há mais nada a manter em sincronia
            // entre as duas telas.
            background: "#04242F",
            boxShadow: "0 30px 70px -24px rgba(4,36,47,0.65)",
          }}
        />
        <div
          className="wx-flutuar pointer-events-none absolute right-10 top-10 h-44 w-44 rounded-full"
          style={{
            background: "radial-gradient(circle at 35% 30%, #9BDCE1, #3A9AA4)",
            boxShadow: "0 0 70px 22px rgba(98,194,202,0.35)",
          }}
        />

        <div className="reveal reveal-1 relative z-10 flex h-full flex-col p-8 text-white">
          <div className="flex items-center">
            {/* Painel escuro FIXO nos dois temas, então a tinta da marca também
                é fixa: `var(--brand)` é o mesmo #62C2CA nos dois temas e mede
                7,9:1 sobre o petróleo do painel. Não usar a classe
                `.text-brand` aqui — ela resolve por `--brand-text`, que é
                escuro no tema claro (#0E6B75) e cairia para ~3,3:1 neste fundo.
                27/08 (edição do Robério no canvas): a marca subiu de 38 para
                55px de altura e saiu do branco para o teal. */}
            {/* A cor vem do contêiner porque o traçado é `currentColor`; o
                componente recebe altura e className, não style. */}
            <span style={{ color: "var(--brand)" }}>
              <WordmarkViratempo altura={55} />
            </span>
          </div>

          <div className="mt-auto">
            {/* Peso 400 nos dois blocos (27/08, edição do Robério no canvas:
                a manchete era 800 e a linha de apoio 500). No canvas ele
                escreveu 100, mas a Inter do painel é carregada em
                400/500/600/700/800 (index.html), então o navegador resolveu
                para o 400 — o 400 é literalmente o que ele viu e aprovou.
                Se a intenção for um traço ainda mais fino, o caminho é
                acrescentar o peso 200 ou 300 na URL da fonte E declarar aqui;
                declarar um peso que não existe no arquivo só produz o 400 de
                novo, em silêncio. */}
            <h1 className="max-w-md text-[52px] font-normal leading-[1.05] tracking-tight">
              A opinião da cidade, em tempo real.
            </h1>
            <p className="mt-4 max-w-sm text-lg font-normal text-white/85">
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
        {/* 440px desde 27/08 (pedido do Robério no canvas), no lugar do
            `max-w-sm` de 384. Continua sendo TETO, e não largura fixa: no
            celular quem manda é o `w-full` dentro do respiro de 24px do
            container, e a altura segue livre — o cartão precisa crescer quando
            entram a mensagem de erro ou o aviso de link enviado. */}
        <div className="w-full max-w-[440px]">
          {/* logo compacta — visível também no mobile */}
          <div className="mb-8 text-txt-1 lg:hidden">
            <WordmarkViratempo altura={30} />
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
                  placeholder="e-mail"
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
                style={{ background: "#04242F" }}
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
              {/* 27/08 (edição do Robério no canvas): o rótulo perdeu o
                  "— definir senha". Além de encurtar, tira desta tela o
                  travessão, que o produto proíbe em texto exibido. */}
              {enviandoSenha ? "Enviando link…" : "Primeiro acesso ou esqueci a senha"}
            </button>

            <p className="mt-4 text-center text-xs text-txt-3">
              Acesso restrito a usuários cadastrados
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
