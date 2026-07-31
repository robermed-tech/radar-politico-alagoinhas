/**
 * "Alertar Secretário" a partir de uma pauta de rádio.
 *
 * Reaproveita o mesmo modal do dashboard (EnvioSecretario), então canal,
 * contato, edição, registro em `message_log` e o aparecimento no Histórico de
 * Alertas são idênticos ao alerta de crise. O que muda é o texto da mensagem e
 * o bloco de contexto.
 *
 * A mensagem sempre leva o instante da citação e o aviso de que a transcrição é
 * automática. Isso não é excesso de zelo: Whisper erra palavra e alucina sobre
 * música, e um secretário que receber uma frase entre aspas vai (com razão)
 * tratar aquilo como o que a rádio disse. Com o instante ele confere no áudio.
 */
import { useMemo, useState } from "react";
import { findSecretario } from "@/config/secretarios";
import { EnvioSecretario } from "@/components/EnvioSecretario";
import { fmtInstante, type RadioPauta } from "@/lib/radio";
import { labelBairro } from "@/lib/format";

function IcoRadio({ className, fill }: { className: string; fill: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ fill }}>
      <path d="M12 6.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0-4.5c-1.1 0-2 .9-2 2 0 .74.4 1.38 1 1.72V6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7V5.72c.6-.34 1-.98 1-1.72 0-1.1-.9-2-2-2zM7 16a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm11 3.5h-6v-2h6v2zm0-3.5h-6v-2h6v2z" />
    </svg>
  );
}

function montarMensagem(p: RadioPauta, cargo: string): string {
  const dia = new Date(p.captado_em).toLocaleDateString("pt-BR");
  const hora = new Date(p.captado_em).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit",
  });
  const instante = fmtInstante(p.ts_inicio);
  const bloco = p.citacao
    ? `🗣️ *Trecho transcrito* (aos ${instante} da captação):\n"${p.citacao}"\n` +
      `_Transcrição automática, confira no áudio antes de citar publicamente._\n\n`
    : "";
  const local = p.localidade ? `📍 Localidade citada: ${labelBairro(p.localidade)}\n` : "";
  const pedido = p.pedido ? `📌 Demanda pedida no ar: ${p.pedido}\n` : "";
  const voz = p.voz ? ` (fala de ${p.voz})` : "";

  return (
    `📻 ESCUTA DO RÁDIO — Radar Político Alagoinhas\n\n` +
    `Prezado(a) ${cargo},\n\n` +
    `A escuta de rádio registrou um assunto que envolve a gestão municipal:\n\n` +
    `📣 Assunto: *${p.assunto}*\n` +
    `📡 Estação: ${p.estacao}${p.programa ? ` (${p.programa})` : ""}${voz}\n` +
    `🕒 Captado em ${dia} às ${hora}\n` +
    local +
    pedido +
    `\n${p.resumo ? `*Resumo:* ${p.resumo}\n\n` : ""}` +
    bloco +
    (p.motivo_interesse ? `*Por que isso interessa à gestão:* ${p.motivo_interesse}\n\n` : "") +
    `⚡ *Solicitação:* avaliar o assunto e, se for o caso, preparar resposta ou esclarecimento à população.\n\n` +
    `Enviado via Radar Político — Central de Inteligência Política de Alagoinhas/BA`
  );
}

export function AlertaRadio({ pauta }: { pauta: RadioPauta }) {
  const [aberto, setAberto] = useState(false);
  // Sem tema, cai na última secretaria da lista (regra do findSecretario) — o
  // usuário troca o contato na mão, que é o comportamento do alerta de crise.
  const sec = findSecretario(pauta.tema ?? pauta.assunto);
  const msg = useMemo(() => montarMensagem(pauta, sec.cargo), [pauta, sec.cargo]);

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition hover:opacity-90 active:scale-95"
        style={{
          // Laranja de marca chapado com tinta quase preta — e não fundo
          // escuro com texto claro (revisão de 28/07), nem degradê (`--brand`
          // é hex único desde 31/07, então preenchimento sólido já é a cor
          // certa nos dois temas).
          background: "var(--brand)",
          color: "#1A0F02",
        }}
        aria-label={`Alertar secretário sobre a pauta ${pauta.assunto}`}
      >
        <IcoRadio className="h-3.5 w-3.5 flex-shrink-0" fill="#1A0F02" />
        <span>Alertar Secretário</span>
      </button>

      <EnvioSecretario
        aberto={aberto}
        onFechar={() => setAberto(false)}
        titulo="Rádio Escuta"
        subtitulo="Encaminhar a pauta ao secretário responsável"
        cor="#F97316"
        icone={<IcoRadio className="h-5 w-5" fill="#F97316" />}
        assunto={`📻 Rádio Escuta — ${pauta.assunto}`}
        mensagemBase={msg}
        tema={pauta.tema ?? "comunicacao"}
        contatoWhatsapp={sec.whatsapp}
        contatoEmail={sec.email}
      >
        <div
          className="mt-4 rounded-xl p-3"
          style={{ background: "rgba(249,115,22,0.07)", border: "1px solid rgba(249,115,22,0.2)" }}
        >
          <div className="text-[12px] font-bold uppercase tracking-widest" style={{ color: "#F97316" }}>
            Pauta captada no rádio
          </div>
          <div className="mt-1 text-base font-extrabold text-txt-1">{pauta.assunto}</div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
            <span className="text-txt-2">{pauta.estacao}</span>
            {pauta.voz && <span className="text-txt-3">fala de {pauta.voz}</span>}
            {pauta.citacao && (
              <span className="text-txt-3">aos {fmtInstante(pauta.ts_inicio)} da captação</span>
            )}
          </div>
        </div>

        {pauta.citacao && (
          <div className="mt-3 rounded-xl border border-line bg-bg-2 p-3">
            <div className="text-[12px] font-bold uppercase tracking-widest text-txt-3">
              Trecho transcrito
            </div>
            <p className="mt-1.5 text-sm italic leading-relaxed text-txt-1">“{pauta.citacao}”</p>
            <div className="mt-1 text-[13px] text-txt-3">
              Transcrição automática, sujeita a erro de palavra. Confira no áudio.
            </div>
          </div>
        )}
      </EnvioSecretario>
    </>
  );
}
