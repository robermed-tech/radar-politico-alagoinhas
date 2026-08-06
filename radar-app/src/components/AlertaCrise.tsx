import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { findSecretario } from "@/config/secretarios";
import { fetchComentariosPorTema } from "@/lib/data";
import { EnvioSecretario } from "@/components/EnvioSecretario";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
} from "@/components/ComentarioBox";

interface Props {
  tema: string;
  pNeg: number;
  posts: number;
  iad: number;
}

/** Resumo concreto do que os comentários dizem sobre o tema. */
interface Evidencia {
  total: number;
  subtema: string;
  citacao: string;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

function montarMensagem(
  tema: string,
  pNeg: number,
  posts: number,
  iad: number,
  cargo: string,
  ev: Evidencia | null
): string {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const bloco = ev
    ? `🗣️ *O que a população está dizendo:*\n` +
      (ev.subtema ? `As reclamações se concentram em *${ev.subtema.replace(/_/g, " ")}*. ` : "") +
      `Há ${ev.total} ${ev.total === 1 ? "comentário negativo" : "comentários negativos"} sobre este tema. Exemplo real:\n` +
      `"${ev.citacao}"\n\n`
    : "";
  return (
    `🚨 ALERTA DE CRISE — Radar Político Alagoinhas\n\n` +
    `Prezado(a) ${cargo},\n\n` +
    `O sistema de inteligência política de Alagoinhas detectou um índice crítico de reprovação popular no tema *"${tema}"*:\n\n` +
    `📊 Negatividade: *${pNeg}%* dos comentários\n` +
    `📌 Posts analisados: ${posts}\n` +
    `📉 IAD (Aprovação Digital): ${iad}/100\n` +
    `📅 Data: ${hoje}\n\n` +
    bloco +
    `A população está expressando insatisfação crescente nas redes sociais, o que pode escalar caso não haja resposta imediata.\n\n` +
    `⚡ *Ação urgente solicitada:* O setor deve avaliar a situação e comunicar medidas à população o quanto antes.\n\n` +
    `Enviado via Radar Político — Central de Inteligência Política de Alagoinhas/BA`
  );
}

/** Ícone de alerta, compartilhado pelo botão e pelo cabeçalho do modal. */
function IcoAlerta({ className, fill }: { className: string; fill: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ fill }}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </svg>
  );
}

export function AlertaCrise({ tema, pNeg, posts, iad }: Props) {
  const [aberto, setAberto] = useState(false);
  const sec = findSecretario(tema);

  // Evidência concreta: os comentários negativos reais deste tema.
  // Só busca quando o modal abre (não paga a query em cada card de alerta).
  const { data: comentarios = [] } = useQuery({
    queryKey: ["comentarios-tema"],
    queryFn: () => fetchComentariosPorTema(),
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: aberto,
  });

  const evidencia = useMemo<Evidencia | null>(() => {
    const alvo = norm(tema);
    const negs = comentarios.filter(
      (c) => norm(c.tema) === alvo && c.sentimento === "negativo" && c.texto.length > 4
    );
    if (negs.length === 0) return null;
    const subCount: Record<string, number> = {};
    for (const c of negs) {
      if (c.subtema && c.subtema !== "outro") subCount[c.subtema] = (subCount[c.subtema] ?? 0) + 1;
    }
    const subtema = Object.entries(subCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    // O comentário negativo mais curtido (comentarios já vem ordenado por curtidas).
    return { total: negs.length, subtema, citacao: trunc(negs[0].texto, 180) };
  }, [comentarios, tema]);

  const baseMsg = useMemo(
    () => montarMensagem(tema, pNeg, posts, iad, sec.cargo, evidencia),
    [tema, pNeg, posts, iad, sec.cargo, evidencia]
  );

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
        <IcoAlerta className="h-4 w-4 flex-shrink-0" fill="#FFFFFF" />
        <span>Alertar Secretário</span>
      </button>

      <EnvioSecretario
        aberto={aberto}
        onFechar={() => setAberto(false)}
        titulo="Alerta de Crise"
        subtitulo="Notificação imediata ao secretário responsável"
        cor="#DC2626"
        icone={<IcoAlerta className="h-5 w-5" fill="#DC2626" />}
        assunto={`🚨 ALERTA DE CRISE — Tema: ${tema}`}
        mensagemBase={baseMsg}
        tema={tema}
        contatoWhatsapp={sec.whatsapp}
        contatoEmail={sec.email}
      >
        {/* Crise detectada */}
        <div
          className="mt-4 rounded-xl p-3"
          style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)" }}
        >
          <div className="text-[12px] font-bold uppercase tracking-widest" style={{ color: "#DC2626" }}>
            Tema crítico detectado
          </div>
          <div className="mt-1 text-base font-extrabold frase-cap text-txt-1">{tema}</div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
            <span className="font-bold" style={{ color: "#DC2626" }}>
              {pNeg}% negatividade
            </span>
            <span className="text-txt-3">{posts} posts analisados</span>
            <span className="text-txt-3">IAD {iad}/100</span>
          </div>
        </div>

        {/* Evidência concreta — o que a população realmente diz sobre o tema */}
        {evidencia && (
          <ComentarioBox className="mt-3">
            <div className="text-[12px] font-bold uppercase tracking-widest text-txt-3">
              O que a população está dizendo
              {evidencia.subtema && (
                <span className="ml-1 normal-case">
                  · foco em <b className="frase-cap">{evidencia.subtema.replace(/_/g, " ")}</b>
                </span>
              )}
            </div>
            <div className="mt-1.5">
              <ComentarioTexto>{evidencia.citacao}</ComentarioTexto>
            </div>
            <ComentarioMeta>
              {evidencia.total} {evidencia.total === 1 ? "comentário negativo" : "comentários negativos"} sobre este tema
            </ComentarioMeta>
          </ComentarioBox>
        )}
      </EnvioSecretario>
    </>
  );
}
