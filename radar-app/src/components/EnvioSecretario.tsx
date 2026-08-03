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
 *
 * Casca visual: ModalShell (linha única de pop-up do painel, 03/08). O botão
 * de enviar é a pílula clara do padrão, não mais verde/azul por canal: verde e
 * vermelho ficam reservados para sentimento, e o canal já está dito no rótulo.
 */
import { useEffect, useState } from "react";
import { logMessageSend } from "@/lib/admin";
import { ModalShell, ModalBotaoPrimario } from "@/components/ModalShell";

export interface EnvioSecretarioProps {
  aberto: boolean;
  onFechar: () => void;
  /** Título do modal (ex.: "Alerta de Crise"). */
  titulo: string;
  subtitulo: string;
  /** Cor de destaque do tile do ícone. */
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

  return (
    <ModalShell
      onFechar={onFechar}
      chip="Envio ao secretário"
      titulo={titulo}
      subtitulo={subtitulo}
      icone={icone}
      corIcone={cor}
      rodape={
        <>
          {feedback && !feedback.startsWith("✓") && (
            <p className="flex-1 text-xs text-risk-crit">{feedback}</p>
          )}
          <button
            onClick={copiar}
            title="Copiar texto"
            className="rounded-xl border border-line bg-bg-2 px-3 py-2.5 text-sm font-semibold text-txt-1 transition hover:bg-bg-3"
          >
            {feedback === "✓ Copiado!" ? "✓ Copiado" : "Copiar"}
          </button>
          <ModalBotaoPrimario onClick={enviar} disabled={!contato.trim()}>
            {feedback?.startsWith("✓ Abrindo")
              ? "✓ Abrindo…"
              : canal === "whatsapp"
              ? "Enviar WhatsApp"
              : "Enviar e-mail"}
          </ModalBotaoPrimario>
        </>
      }
    >
      {/* Contexto específico da origem */}
      {children}

      {/* Canal */}
      <div className="mt-4 flex w-fit gap-0.5 rounded-lg border border-line bg-bg-2 p-0.5">
        {(["whatsapp", "email"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCanal(c)}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-all ${
              canal === c ? "bg-brand text-brand-ink" : "text-txt-3 hover:text-txt-1"
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
    </ModalShell>
  );
}
