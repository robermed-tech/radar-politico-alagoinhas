import { useState } from "react";
import { createPortal } from "react-dom";
import { findSecretario } from "@/config/secretarios";

interface Props {
  /** Tema com maior índice de negatividade */
  tema: string;
  /** Percentual de comentários negativos (0-100) */
  pNeg: number;
  /** Quantidade de posts analisados no período */
  posts: number;
  /** IAD atual (0-100) */
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
  const msg = montarMensagem(tema, pNeg, posts, iad, sec.cargo);
  const msgEnc = encodeURIComponent(msg);
  const whatsappNum = sec.whatsapp.replace(/\D/g, "");

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

      {/* Modal — renderizado via Portal no document.body para evitar stacking context dos containers pai */}
      {aberto && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)" }}
          onClick={(e) => e.target === e.currentTarget && setAberto(false)}
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-bg-1 p-5 shadow-2xl">
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

            {/* Destinatário */}
            <div className="mt-3 rounded-lg border border-line bg-bg-2 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-txt-3">
                Destinatário
              </div>
              <div className="mt-1 text-sm font-bold text-txt-1">{sec.nome}</div>
              <div className="text-[11px] text-txt-3">{sec.email}</div>
            </div>

            {/* Preview da mensagem */}
            <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-line bg-bg-2 p-3 text-[11px] leading-relaxed text-txt-2 whitespace-pre-line">
              {msg}
            </div>

            {/* Aviso sobre contatos */}
            <div className="mt-2 text-[10px] text-txt-3">
              * Configure os contatos em <code>src/config/secretarios.ts</code>
            </div>

            {/* Botões de envio */}
            <div className="mt-4 flex flex-col gap-2">
              {/* WhatsApp */}
              <a
                href={`https://wa.me/${whatsappNum}?text=${msgEnc}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition hover:opacity-90"
                style={{ background: "#16A34A" }}
                onClick={() => setAberto(false)}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white flex-shrink-0">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                WhatsApp
              </a>

              {/* E-mail */}
              <a
                href={`mailto:${sec.email}?subject=${encodeURIComponent(`🚨 ALERTA DE CRISE — Tema: ${tema}`)}&body=${encodeURIComponent(msg)}`}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition hover:opacity-90"
                style={{ background: "#2563EB" }}
                onClick={() => setAberto(false)}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white flex-shrink-0">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
                </svg>
                E-mail
              </a>

              {/* SMS */}
              <a
                href={`sms:${sec.whatsapp}?&body=${msgEnc}`}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-bold text-txt-1 transition hover:bg-bg-2"
                onClick={() => setAberto(false)}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-txt-2 flex-shrink-0">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                </svg>
                SMS
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
