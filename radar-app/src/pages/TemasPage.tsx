import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyThemes, fetchNarratives, type DailyTheme, type Narrative } from "@/lib/data";

const TEMA_EMOJI: Record<string, string> = {
  saude: "🏥",
  educacao: "📚",
  obras: "🏗",
  seguranca: "🛡",
  transporte: "🚌",
  emprego: "💼",
  impostos: "💰",
  outros: "📌",
};

function toLabel(tema: string): string {
  return tema.charAt(0).toUpperCase() + tema.slice(1);
}

function direcaoSlope(serie: number[]): "subindo" | "estavel" | "caindo" {
  if (serie.length < 2) return "estavel";
  const n = serie.length;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = serie.reduce((s, v) => s + v, 0);
  const sumXY = serie.reduce((s, v, i) => s + v * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  const s = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  if (s > 0.1) return "subindo";
  if (s < -0.1) return "caindo";
  return "estavel";
}

const DIR_ICON: Record<string, string> = { subindo: "▲", estavel: "─", caindo: "▼" };
const DIR_COR: Record<string, string> = {
  subindo: "#22C55E",
  estavel: "#9FB0CC",
  caindo: "#EF4444",
};

const SENT_COR: Record<string, string> = {
  positivo: "#22C55E",
  negativo: "#EF4444",
  neutro: "#9FB0CC",
  misto: "#EAB308",
};

const SENT_LABEL: Record<string, string> = {
  positivo: "Favorável",
  negativo: "Crítico",
  neutro: "Neutro",
  misto: "Dividido",
};

const STATUS_LABEL: Record<string, string> = {
  ativa: "Em alta",
  esfriando: "Esfriando",
  encerrada: "Encerrado",
};
const STATUS_COR: Record<string, string> = {
  ativa: "#22C55E",
  esfriando: "#EAB308",
  encerrada: "#5F6E8C",
};

interface TemaResumido {
  tema: string;
  pctNeg: number;
  pctPos: number;
  volume: number;
  direcao: "subindo" | "estavel" | "caindo";
  narrativa?: Narrative;
}

function buildTemas(themes: DailyTheme[], narratives: Narrative[]): TemaResumido[] {
  const byTema: Record<string, number[]> = {};
  const byTemaVol: Record<string, number> = {};
  const byTemaPos: Record<string, number[]> = {};
  const byTemaNeg: Record<string, number[]> = {};

  for (const t of themes) {
    const k = t.tema?.toLowerCase() || "outros";
    byTema[k] = byTema[k] ?? [];
    byTema[k].push(t.pct_neg);
    byTemaVol[k] = (byTemaVol[k] ?? 0) + t.volume_posts;
    byTemaPos[k] = byTemaPos[k] ?? [];
    byTemaPos[k].push(t.pct_pos);
    byTemaNeg[k] = byTemaNeg[k] ?? [];
    byTemaNeg[k].push(t.pct_neg);
  }

  const narrMap: Record<string, Narrative> = {};
  for (const n of narratives) {
    const k = n.tema?.toLowerCase() || "";
    if (!narrMap[k] || (n.status === "ativa" && narrMap[k].status !== "ativa")) {
      narrMap[k] = n;
    }
  }

  return Object.entries(byTema)
    .map(([tema, serie]) => {
      const ultPos = byTemaPos[tema] ?? [];
      const ultNeg = byTemaNeg[tema] ?? [];
      return {
        tema,
        pctNeg: Math.round(ultNeg.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ultNeg.length))),
        pctPos: Math.round(ultPos.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ultPos.length))),
        volume: byTemaVol[tema] ?? 0,
        direcao: direcaoSlope(serie),
        narrativa: narrMap[tema],
      };
    })
    .filter((t) => t.volume > 0)
    .sort((a, b) => b.pctNeg - a.pctNeg || b.volume - a.volume);
}

function BarraSentimento({ pctPos, pctNeg }: { pctPos: number; pctNeg: number }) {
  const pctNeu = Math.max(0, 100 - pctPos - pctNeg);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div style={{ width: `${pctPos}%`, background: "#22C55E" }} />
      <div style={{ width: `${pctNeu}%`, background: "#2A364E" }} />
      <div style={{ width: `${pctNeg}%`, background: "#EF4444" }} />
    </div>
  );
}

const SECRETARIA_NOME: Record<string, string> = {
  saude: "Sec. de Saúde",
  educacao: "Sec. de Educação",
  obras: "Sec. de Obras e Infraestrutura",
  seguranca: "Sec. de Segurança Pública",
  transporte: "Sec. de Transportes",
  emprego: "Sec. de Desenvolvimento Econômico",
  impostos: "Sec. de Fazenda",
  outros: "Secretaria responsável",
};

function gerarTextoAlerta(t: TemaResumido): string {
  const tema = toLabel(t.tema);
  const sec = SECRETARIA_NOME[t.tema] ?? "Secretaria responsável";
  const tend = t.direcao === "subindo" ? "em crescimento" : t.direcao === "caindo" ? "diminuindo" : "estável";
  const linhas = [
    `Prezado(a) ${sec},`,
    ``,
    `O Radar Político identificou que o tema "${tema}" está em situação CRÍTICA e ${tend} nas redes sociais de Alagoinhas.`,
    ``,
    `📊 Situação atual:`,
    `• ${t.pctNeg}% dos comentários são negativos`,
    `• ${t.pctPos}% são favoráveis`,
    `• ${t.volume} publicações analisadas`,
  ];
  if (t.narrativa?.queixa_top) {
    linhas.push(``, `💬 Principal reclamação da população:`, `"${t.narrativa.queixa_top}"`);
  }
  linhas.push(``, `Solicitamos avaliação e providências urgentes.`, ``, `Atenciosamente,`, `Gabinete do Prefeito · Radar Político`);
  return linhas.join("\n");
}

function AlertaSecretarioBox({ t }: { t: TemaResumido }) {
  const [canal, setCanal] = useState<"whatsapp" | "email">("whatsapp");
  const [contato, setContato] = useState("");
  const [mensagem, setMensagem] = useState(() => gerarTextoAlerta(t));
  const [feedback, setFeedback] = useState<string | null>(null);

  const tema = toLabel(t.tema);
  const assunto = `⚠ Radar Político — ${tema} em situação crítica`;

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  function enviar() {
    if (!contato.trim()) { flash("Preencha o contato"); return; }
    if (canal === "email") {
      window.open(`mailto:${contato.trim()}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`);
    } else {
      const num = contato.replace(/\D/g, "");
      window.open(`https://wa.me/${num.startsWith("55") ? num : "55" + num}?text=${encodeURIComponent(mensagem)}`, "_blank");
    }
    flash("✓ Abrindo…");
  }

  function copiar() {
    navigator.clipboard.writeText(mensagem).then(() => flash("✓ Copiado!"));
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-5"
      style={{ borderColor: "rgba(249,115,22,0.35)", background: "rgba(249,115,22,0.04)" }}
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-extrabold text-txt-1">📣 Acionar Secretaria</div>
          <div className="text-xs text-txt-3">{SECRETARIA_NOME[t.tema] ?? "Secretaria responsável"}</div>
        </div>
        {/* Toggle canal */}
        <div className="flex gap-0.5 rounded-lg border border-line bg-bg-2 p-0.5">
          {(["whatsapp", "email"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCanal(c)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                canal === c ? "bg-brand text-white" : "text-txt-3 hover:text-txt-1"
              }`}
            >
              {c === "whatsapp" ? "WhatsApp" : "E-mail"}
            </button>
          ))}
        </div>
      </div>

      {/* Contato */}
      <div>
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
      <div className="flex flex-1 flex-col">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">Mensagem</label>
          <button
            onClick={() => setMensagem(gerarTextoAlerta(t))}
            className="text-[10px] font-semibold text-brand hover:underline"
          >
            ↺ Regenerar
          </button>
        </div>
        <textarea
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          rows={9}
          className="w-full flex-1 resize-none rounded-lg border border-line bg-bg-2 px-3 py-2 text-xs leading-relaxed text-txt-1 outline-none transition focus:border-brand"
          style={{ fontFamily: "JetBrains Mono, monospace" }}
        />
      </div>

      {/* Ações */}
      <div className="flex gap-2">
        <button
          onClick={enviar}
          disabled={!contato.trim()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
          style={{ background: canal === "whatsapp" ? "#22C55E" : "#F97316" }}
        >
          {feedback?.startsWith("✓ Abrindo")
            ? "✓ Abrindo…"
            : canal === "whatsapp"
            ? "💬 Enviar WhatsApp"
            : "📧 Enviar E-mail"}
        </button>
        <button
          onClick={copiar}
          title="Copiar texto"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-sm transition hover:bg-bg-3"
        >
          {feedback === "✓ Copiado!" ? "✓" : "📋"}
        </button>
      </div>

      {feedback && !feedback.startsWith("✓") && (
        <p className="text-xs text-risk-crit">{feedback}</p>
      )}
    </div>
  );
}

function TemaCard({ t }: { t: TemaResumido }) {
  const emoji = TEMA_EMOJI[t.tema] ?? "📌";
  const dirCor = DIR_COR[t.direcao];
  const narr = t.narrativa;
  const sentCor = narr ? SENT_COR[narr.sentimento] ?? "#9FB0CC" : "#9FB0CC";
  const sentLabel = narr ? SENT_LABEL[narr.sentimento] ?? narr.sentimento : null;
  const statusLabel = narr ? STATUS_LABEL[narr.status] ?? narr.status : null;
  const statusCor = narr ? STATUS_COR[narr.status] ?? "#5F6E8C" : "#5F6E8C";

  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{emoji}</span>
          <div>
            <div className="font-bold text-txt-1">{toLabel(t.tema)}</div>
            <div className="mt-0.5 flex items-center gap-2">
              {sentLabel && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-bold"
                  style={{ background: `${sentCor}1A`, color: sentCor }}
                >
                  {sentLabel}
                </span>
              )}
              {statusLabel && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-semibold"
                  style={{ background: `${statusCor}1A`, color: statusCor }}
                >
                  {statusLabel}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-lg font-extrabold" style={{ color: dirCor }}>
            {DIR_ICON[t.direcao]}
          </span>
          <span className="text-xs text-txt-3">{t.volume} posts</span>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <BarraSentimento pctPos={t.pctPos} pctNeg={t.pctNeg} />
        <div className="flex justify-between text-xs text-txt-3">
          <span className="text-risk-low">{t.pctPos}% favorável</span>
          <span className="text-risk-crit">{t.pctNeg}% crítico</span>
        </div>
      </div>

      {narr?.queixa_top && (
        <div className="mt-3 rounded-lg bg-bg-2 px-3 py-2">
          <div className="text-xs font-semibold text-txt-3">O que o povo reclama</div>
          <p className="mt-0.5 text-sm text-txt-1">{narr.queixa_top}</p>
        </div>
      )}

      {narr?.elogio_top && !narr.queixa_top && (
        <div className="mt-3 rounded-lg bg-bg-2 px-3 py-2">
          <div className="text-xs font-semibold text-txt-3">O que o povo elogia</div>
          <p className="mt-0.5 text-sm text-txt-1">{narr.elogio_top}</p>
        </div>
      )}

      {narr?.comentario_top && (
        <p className="mt-2 text-xs italic text-txt-2 line-clamp-2">
          "{narr.comentario_top}"
        </p>
      )}
    </div>
  );
}

export function TemasPage() {
  const { data: themes = [], isLoading: loadThemes } = useQuery({
    queryKey: ["daily-themes"],
    queryFn: fetchDailyThemes,
    staleTime: 5 * 60 * 1000,
  });

  const { data: narratives = [] } = useQuery({
    queryKey: ["narratives"],
    queryFn: fetchNarratives,
    staleTime: 5 * 60 * 1000,
  });

  const temas = useMemo(() => buildTemas(themes, narratives), [themes, narratives]);

  const emAlta = temas.filter((t) => t.direcao === "subindo");
  const demais = temas.filter((t) => t.direcao !== "subindo");

  if (loadThemes) return <div className="p-8 text-txt-2">Carregando temas…</div>;

  if (temas.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Temas em Alta</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda sem histórico de temas. Execute o fluxo ÁGORA para popular.
        </div>
      </div>
    );

  return (
    <div className="space-y-5 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Temas em Alta</h1>
        <p className="text-sm text-txt-2">
          O que a população mais comenta — e se está crescendo ou diminuindo
        </p>
      </div>

      {emAlta.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-risk-low font-bold">▲</span>
            <h2 className="text-sm font-extrabold text-txt-1">Crescendo agora</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Primeiro tema crítico + caixa de alerta no slot vazio */}
            <TemaCard t={emAlta[0]} />
            <AlertaSecretarioBox t={emAlta[0]} />
            {emAlta.slice(1).map((t) => <TemaCard key={t.tema} t={t} />)}
          </div>
        </section>
      )}

      {demais.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-txt-3 font-bold">─</span>
            <h2 className="text-sm font-extrabold text-txt-1">Demais temas</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Se não há emAlta, mostra a caixa de alerta ao lado do tema mais crítico */}
            <TemaCard t={demais[0]} />
            {emAlta.length === 0 && <AlertaSecretarioBox t={demais[0]} />}
            {demais.slice(emAlta.length === 0 ? 1 : 0).map((t) => <TemaCard key={t.tema} t={t} />)}
          </div>
        </section>
      )}

      <p className="text-xs text-txt-3">
        A barra mostra a proporção de comentários favoráveis (verde) e críticos (vermelho) nos últimos 3 dias.
        A seta indica se o tema está ganhando ou perdendo força.
      </p>
    </div>
  );
}
