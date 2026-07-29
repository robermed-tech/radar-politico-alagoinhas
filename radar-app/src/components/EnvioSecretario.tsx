/**
 * Modal de envio ao secretário — canal, contato, mensagem editável, copiar e
 * enviar por WhatsApp ou e-mail, com registro em `message_log`.
 *
 * Foi extraído do AlertaCrise quando a Escuta do Rádio passou a precisar do
 * mesmo box: o cliente pediu "igual ao que já existe no dashboard", e a única
 * forma de garantir que continue igual é ser o mesmo componente. Duas cópias
 * divergiriam no primeiro ajuste de texto ou de canal.
 *
 * O que é comum vive aqui (canal, contato, textarea, regenerar, copiar, enviar,
 * log). O que é específico de cada origem chega por props: o cabeçalho, o bloco
 * de contexto (`children`) e a mensagem base já montada.
 *
 * O envio continua MANUAL, decisão da reunião de 24/07: o componente abre o
 * WhatsApp ou o cliente de e-mail com o texto pronto, e quem aperta enviar é a
 * pessoa. Nada é disparado por conta própria.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { logMessageSend } from "@/lib/admin";

export interface EnvioSecretarioProps {
  aberto: boolean;
  onFechar: () => void;
  /** Título do modal (ex.: "Alerta de Crise"). */
  titulo: string;
  subtitulo: string;
  /** Cor de destaque do cabeçalho. */
  cor?: string;
  /** Ícone do cabeçalho. */
  icone: React.ReactNode;
  /** Assunto usado no e-mail. */
  assunto: string;
  /** Texto sugerido. Enquanto o usuário não editar à mão, acompanha mudanças. */
  mensagemBase: string;
  /** Vai para message_log.tema e alimenta o Histórico de Alertas. */
  tema: string;
  contatoWhatsapp: string;
  contatoEmail: string;
  /** Bloco de contexto específico da origem (crise, pauta de rádio…). */
  children?: React.ReactNode;
}

export function EnvioSecretario({
  aberto, onFechar, titulo, subtitulo, cor = "#DC2626", icone,
  assunto, mensagemBase, tema, contatoWhatsapp, contatoEmail, children,
}: EnvioSecretarioProps) {
  const [canal, setCanal] = useState<"whatsapp" | "email">("whatsapp");
  const [contato, setContato] = useState(contatoWhatsapp);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState(mensagemBase);
  const [editado, setEditado] = useState(false);

  // Enquanto o usuário não editar à mão, a mensagem acompanha a base (que pode
  // chegar depois, quando a evidência vem de uma query assíncrona).
  useEffect(() => {
    if (!editado) setMensagem(mensagemBase);
  }, [mensagemBase, editado]);

  // O contato default acompanha o canal e a origem (secretaria diferente por
  // tema), mas nunca sobrescreve o que o usuário digitou.
  useEffect(() => {
    setContato(canal === "email" ? contatoEmail : contatoWhatsapp);
  }, [canal, contatoEmail, contatoWhatsapp]);

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  function enviar() {
    if (!contato.trim()) { flash("Preencha o contato"); return; }
    if (canal === "email") {
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
    void logMessageSend(canal, contato.trim(), { tema, mensagem });
    flash("✓ Abrindo…");
  }

  function copiar() {
    navigator.clipboard.writeText(mensagem).then(() => flash("✓ Copiado!"));
  }

  if (!aberto) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-bg-1 p-5 shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl"
              style={{ background: `${cor}1F` }}
            >
              {icone}
            </div>
            <div>
              <div className="font-extrabold text-txt-1">{titulo}</div>
              <div className="text-[13px] text-txt-3">{subtitulo}</div>
            </div>
          </div>
          <button
            onClick={onFechar}
            className="cursor-pointer rounded-lg p-1 text-txt-3 transition hover:text-txt-1"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Contexto específico da origem */}
        {children}

        {/* Canal */}
        <div className="mt-4 flex w-fit gap-0.5 rounded-lg border border-line bg-bg-2 p-0.5">
          {(["whatsapp", "email"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCanal(c)}
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
          <label className="mb-1 block text-[13px] font-semibold uppercase tracking-wide text-txt-3">
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
            <label className="text-[13px] font-semibold uppercase tracking-wide text-txt-3">
              Mensagem
            </label>
            <button
              onClick={() => { setEditado(false); setMensagem(mensagemBase); }}
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              ↺ Regenerar
            </button>
          </div>
          <textarea
            value={mensagem}
            onChange={(e) => { setEditado(true); setMensagem(e.target.value); }}
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
  );
}
