import { useState } from "react";
import { createPortal } from "react-dom";
import { findSecretario } from "@/config/secretarios";
import { logMessageSend } from "@/lib/admin";

interface Props {
  tema: string;
  pNeg: number;
  posts: number;
  iad: number;
}

function montarMensagem(
  tema: string,
  pNeg: number,
  posts: number,
  iad: number,
  cargo: string
): string {
  const hoje = new Date().toLocaleDateString("pt-BR");
  return (
    `🚨 ALERTA DE CRISE — Radar Político Alagoinhas\n\n` +
    `Prezado(a) ${cargo},\n\n` +
    `O sistema de inteligência política de Alagoinhas detectou um índice crítico de reprovação popular no tema *"${tema}"*:\n\n` +
    `📊 Negatividade: *${pNeg}%* dos comentários\n` +
    `📌 Posts analisados: ${posts}\n` +
    `📉 IAD (Aprovação Digital): ${iad}/100\n` +
    `📅 Data: ${hoje}\n\n` +
    `A população está expressando insatisfação crescente nas redes sociais, o que pode escalar caso não haja resposta imediata.\n\n` +
    `⚡ *Ação urgente solicitada:* O setor deve avaliar a situação e comunicar medidas à população o quanto antes.\n\n` +
    `Enviado via Radar Político — Central de Inteligência Política de Alagoinhas/BA`
  );
}

export function AlertaCrise({ tema, pNeg, posts, iad }: Props) {
  const [aberto, setAberto] = useState(false);
  const sec = findSecretario(tema);
  const [canal, setCanal] = useState<"whatsapp" | "email">("whatsapp");
  const [contato, setContato] = useState(sec.whatsapp);
  const [mensagem, setMensagem] = useState(() => montarMensagem(tema, pNeg, posts, iad, sec.cargo));
  const [feedback, setFeedback] = useState<string | null>(null);

  function switchCanal(c: "whatsapp" | "email") {
    setCanal(c);
    setContato(c === "email" ? sec.email : sec.whatsapp);
  }

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  function enviar() {
    if (!contato.trim()) { flash("Preencha o contato"); return; }
    if (canal === "email") {
      const assunto = `🚨 ALERTA DE CRISE — Tema: ${tema}`;
      window.open(
        `mailto:${contato.trim()}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`
      );
    } else {
      const num = contato.replace(/\D/g, "");
      window.open(
        `https://wa.me/${num.startsWith("55") ? num : "55" + num}?text=${encodeURIComponent(mensagem)}`,
        "_blank"
      );
    }
    void logMessageSend(canal, contato.trim());
    flash("✓ Abrindo…");
  }

  function copiar() {
    navigator.clipboard.writeText(mensagem).then(() => flash("✓ Copiado!"));
  }

  return (
    <>
      {/* Botão de alerta — aparece pulsando */}
      <button
        onClick={() => setAberto(true)}
        className="animate-pulse flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #DC2626, #991B1B)",
          boxShadow: "0 0 16px rgba(220,38,38,0.5)",
        }}
        aria-label={`Alertar secretário sobre crise no tema ${tema}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white flex-shrink-0">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
        <span>Alertar Secretário</span>
      </button>

      {/* Modal — renderizado via Portal no document.body para evitar stacking context */}
      {aberto && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)" }}
          onClick={(e) => e.target === e.currentTarget && setAberto(false)}
        >
          <div className="w-full max-w-lg rounded-2xl border border-line bg-bg-1 p-5 shadow-2xl">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl"
                  style={{ background: "rgba(220,38,38,0.12)" }}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: "#DC2626" }}>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                  </svg>
                </div>
                <div>
                  <div className="font-extrabold text-txt-1">Alerta de Crise</div>
                  <div className="text-[11px] text-txt-3">Notificação imediata ao secretário responsável</div>
                </div>
              </div>
              <button
                onClick={() => setAberto(false)}
                className="cursor-pointer rounded-lg p-1 text-txt-3 hover:text-txt-1 transition"
                aria-label="Fechar"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>

            {/* Crise detectada */}
            <div
              className="mt-4 rounded-xl p-3"
              style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)" }}
            >
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#DC2626" }}>
                Tema crítico detectado
              </div>
              <div className="mt-1 text-base font-extrabold capitalize text-txt-1">{tema}</div>
              <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
                <span className="font-bold" style={{ color: "#DC2626" }}>
                  {pNeg}% negatividade
                </span>
                <span className="text-txt-3">{posts} posts analisados</span>
                <span className="text-txt-3">IAD {iad}/100</span>
              </div>
            </div>

            {/* Canal selector */}
            <div className="mt-4 flex gap-0.5 rounded-lg border border-line bg-bg-2 p-0.5 w-fit">
              {(["whatsapp", "email"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => switchCanal(c)}
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition-all ${
                    canal === c ? "bg-brand text-white" : "text-txt-3 hover:text-txt-1"
                  }`}
                >
                  {c === "whatsapp" ? "WhatsApp" : "E-mail"}
                </button>
              ))}
            </div>

            {/* Contato */}
            <div className="mt-3">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                {canal === "email" ? "E-mail do(a) secretário(a)" : "WhatsApp com DDD"}
              </label>
              <input
                type={canal === "email" ? "email" : "tel"}
                value={contato}
                onChange={(e) => setContato(e.target.value)}
                placeholder={canal === "email" ? "secretario@prefeitura.ba.gov.br" : "75 9 9999-0000"}
                className="w-full rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none transition focus:border-brand"
              />
            </div>

            {/* Mensagem */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                  Mensagem
                </label>
                <button
                  onClick={() => setMensagem(montarMensagem(tema, pNeg, posts, iad, sec.cargo))}
                  className="text-[10px] font-semibold text-brand hover:underline"
                >
                  ↺ Regenerar
                </button>
              </div>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={6}
                className="w-full resize-none rounded-lg border border-line bg-bg-2 px-3 py-2 text-xs leading-relaxed text-txt-1 outline-none transition focus:border-brand"
                style={{ fontFamily: "JetBrains Mono, monospace" }}
              />
            </div>

            {/* Ações */}
            <div className="mt-4 flex items-center gap-2">
              {feedback && !feedback.startsWith("✓") && (
                <p className="flex-1 text-xs text-risk-crit">{feedback}</p>
              )}
              <button
                onClick={copiar}
                title="Copiar texto"
                className="rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-sm transition hover:bg-bg-3"
              >
                {feedback === "✓ Copiado!" ? "✓" : "📋"}
              </button>
              <button
                onClick={enviar}
                disabled={!contato.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
                style={{ background: canal === "whatsapp" ? "#16A34A" : "#2563EB" }}
              >
                {feedback?.startsWith("✓ Abrindo")
                  ? "✓ Abrindo…"
                  : canal === "whatsapp"
                  ? "💬 Enviar WhatsApp"
                  : "📧 Enviar E-mail"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
