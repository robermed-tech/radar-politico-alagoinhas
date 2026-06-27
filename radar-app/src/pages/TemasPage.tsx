import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchDailyThemes,
  fetchNarratives,
  type DailyTheme,
  type Narrative,
} from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";

// ── Métricas do gráfico ──────────────────────────────────────────────────────
type Metrica = "volume" | "pct_neg" | "pct_pos";
const METRICAS: { id: Metrica; label: string; campo: keyof DailyTheme; cor: string }[] = [
  { id: "volume",  label: "Volume (posts)", campo: "volume_posts", cor: "#3B82F6" },
  { id: "pct_neg", label: "% Negativo",    campo: "pct_neg",      cor: "#EF4444" },
  { id: "pct_pos", label: "% Positivo",    campo: "pct_pos",      cor: "#22C55E" },
];

// ── Regressão linear (unificada) ─────────────────────────────────────────────
function linearSlope(serie: number[]): number {
  const n = serie.length;
  if (n < 2) return 0;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = serie.reduce((s, v) => s + v, 0);
  const sumXY = serie.reduce((s, v, i) => s + v * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function direcao(s: number): "subindo" | "estavel" | "caindo" {
  if (s > 0.1) return "subindo";
  if (s < -0.1) return "caindo";
  return "estavel";
}

function direcaoSlope(serie: number[]): "subindo" | "estavel" | "caindo" {
  return direcao(linearSlope(serie));
}

const COR_OUTROS = "#94A3B8";

// ── Interfaces ───────────────────────────────────────────────────────────────
interface TemaResumido {
  tema: string;
  pctNeg: number;
  pctPos: number;
  volume: number;
  direcao: "subindo" | "estavel" | "caindo";
  narrativa?: Narrative;
}

interface TemaStats {
  tema: string;
  serie: number[];
  dias: string[];
  total: number;
  s: number;
  ultimo: number;
}

// ── Constantes de tema ───────────────────────────────────────────────────────
const TEMA_EMOJI: Record<string, string> = {
  saude: "🏥", educacao: "📚", obras: "🏗", seguranca: "🛡",
  transporte: "🚌", emprego: "💼", impostos: "💰", outros: "📌",
};

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

function toLabel(tema: string): string {
  return tema.charAt(0).toUpperCase() + tema.slice(1);
}

// ── buildTemas: agrega daily_themes + narrativas para AlertaSecretarioBox ────
function buildTemas(themes: DailyTheme[], narratives: Narrative[]): TemaResumido[] {
  const byTema: Record<string, number[]>    = {};
  const byTemaVol: Record<string, number>   = {};
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

// ── Gerar texto de alerta ────────────────────────────────────────────────────
function gerarTextoAlerta(t: TemaResumido): string {
  const tema = toLabel(t.tema);
  const sec  = SECRETARIA_NOME[t.tema] ?? "Secretaria responsável";
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

// ── AlertaSecretarioBox ──────────────────────────────────────────────────────
function AlertaSecretarioBox({ t }: { t: TemaResumido }) {
  const [canal, setCanal]       = useState<"whatsapp" | "email">("whatsapp");
  const [contato, setContato]   = useState("");
  const [mensagem, setMensagem] = useState(() => gerarTextoAlerta(t));
  const [feedback, setFeedback] = useState<string | null>(null);

  const assunto = `⚠ Radar Político — ${toLabel(t.tema)} em situação crítica`;

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
      className="flex flex-1 flex-col rounded-xl border p-5"
      style={{ borderColor: "rgba(249,115,22,0.35)", background: "rgba(249,115,22,0.04)" }}
    >
      {/* Cabeçalho */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{TEMA_EMOJI[t.tema] ?? "📌"}</span>
          <div>
            <div className="text-sm font-extrabold text-txt-1">📣 Acionar Secretaria</div>
            <div className="text-xs text-txt-3">
              {SECRETARIA_NOME[t.tema] ?? "Secretaria responsável"} · tema mais crítico
            </div>
          </div>
        </div>
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

      {/* Contato + textarea em grid */}
      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-3">
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
                ? "💬 Enviar"
                : "📧 Enviar"}
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

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
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
            rows={7}
            className="w-full resize-none rounded-lg border border-line bg-bg-2 px-3 py-2 text-xs leading-relaxed text-txt-1 outline-none transition focus:border-brand"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export function TemasPage() {
  const [metrica, setMetrica] = useState<Metrica>("volume");
  const [janela, setJanela]   = useState(14);
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data: themes = [], isLoading } = useQuery({
    queryKey: ["daily-themes"],
    queryFn: fetchDailyThemes,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const { data: narratives = [] } = useQuery({
    queryKey: ["narratives"],
    queryFn: fetchNarratives,
    staleTime: 5 * 60 * 1000,
  });
  // Tema mais crítico (para AlertaSecretarioBox)
  const temas = useMemo(() => buildTemas(themes, narratives), [themes, narratives]);
  const alertaTema = temas[0];

  // Dados de tendência para os gráficos
  const view = useMemo(() => {
    if (themes.length === 0) return null;
    const metr    = METRICAS.find((m) => m.id === metrica)!;
    const cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - janela);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtradas = themes.filter((r) => r.dia >= cutoffStr);
    const dias      = Array.from(new Set(filtradas.map((r) => r.dia))).sort();
    const temasList = Array.from(new Set(filtradas.map((r) => r.tema)));

    const stats: TemaStats[] = temasList.map((t) => {
      const map: Record<string, number> = {};
      filtradas.filter((r) => r.tema === t).forEach((r) => {
        map[r.dia] = Number(r[metr.campo] ?? 0);
      });
      const serie = dias.map((d) => map[d] ?? 0);
      return {
        tema:   t,
        serie,
        dias,
        total:  serie.reduce((s, v) => s + v, 0),
        s:      linearSlope(serie),
        ultimo: serie.at(-1) ?? 0,
      };
    });

    stats.sort((a, b) => b.total - a.total);
    const outrosTemasSet = new Set(stats.slice(7).map((s) => s.tema));
    return { stats, outrosTemasSet, metr };
  }, [themes, metrica, janela]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando tendências…</div>;

  if (!view || themes.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Tendências</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda sem histórico de temas. Execute o fluxo ÁGORA para popular.
        </div>
      </div>
    );

  const { stats, outrosTemasSet, metr } = view;

  const movers = [...stats]
    .sort((a, b) => Math.abs(b.s) - Math.abs(a.s))
    .slice(0, 12)
    .sort((a, b) => a.s - b.s);

  // Vermelho = subindo (mais negativo/volume = alarme), Verde = caindo (melhora)
  const corSlope = (s: number) => (s > 0.1 ? "#EF4444" : s < -0.1 ? "#22C55E" : "#9FB0CC");

  const option = {
    grid: { left: 120, right: 48, top: 10, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (ps: { name: string; value: number }[]) => {
        const v = Number(ps[0].value);
        const dir = v > 0.1 ? "subindo" : v < -0.1 ? "caindo" : "estável";
        const unidade = metrica === "volume" ? "posts/dia" : "pt/dia";
        return `<b>${ps[0].name}</b><br/>${dir}: ${v > 0 ? "+" : ""}${v.toFixed(1)} ${unidade}`;
      },
    },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: { color: ink.axis, fontSize: 10 },
    },
    yAxis: {
      type: "category",
      data: movers.map((s) => s.tema),
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 11 },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        data: movers.map((s) => ({
          value: Number(s.s.toFixed(2)),
          itemStyle: glassBar(corSlope(s.s), {
            horizontal: true,
            radius: s.s < 0 ? [6, 0, 0, 6] : [0, 6, 6, 0],
          }),
        })),
      },
    ],
  };

  const subindo = stats.filter((s) => direcao(s.s) === "subindo");
  const caindo  = stats.filter((s) => direcao(s.s) === "caindo");

  return (
    <div className="space-y-4 p-5">
      {/* Cabeçalho + controles */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Tendências</h1>
          <p className="text-sm text-txt-2">
            Evolução de cada tema — quem está subindo, estável ou caindo
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setJanela(d)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  janela === d ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {METRICAS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetrica(m.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  metrica === m.id ? "bg-bg-3 text-txt-1" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Subindo + Caindo (esquerda) | AlertaSecretarioBox (direita) */}
      <div className="grid items-stretch gap-3 sm:grid-cols-2">
        {/* Coluna esquerda: Subindo + Caindo empilhados */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-bg-1 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-crit">
              ▲ Subindo ({subindo.length})
            </div>
            <div className="space-y-1.5">
              {subindo.slice(0, 5).map((s) => {
                const isOut = outrosTemasSet.has(s.tema);
                return (
                  <div key={s.tema} className="flex items-center justify-between text-sm">
                    <span className="text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                      {s.tema}
                    </span>
                    <span className="tnum font-bold" style={{ color: isOut ? COR_OUTROS : "#EF4444" }}>
                      +{s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                    </span>
                  </div>
                );
              })}
              {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-bg-1 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-low">
              ▼ Caindo ({caindo.length})
            </div>
            <div className="space-y-1.5">
              {caindo.slice(0, 5).map((s) => {
                const isOut = outrosTemasSet.has(s.tema);
                return (
                  <div key={s.tema} className="flex items-center justify-between text-sm">
                    <span className="text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                      {s.tema}
                    </span>
                    <span className="tnum font-bold" style={{ color: isOut ? COR_OUTROS : "#22C55E" }}>
                      {s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                    </span>
                  </div>
                );
              })}
              {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
            </div>
          </div>
        </div>

        {/* Coluna direita: Acionar Secretaria ocupa toda a altura */}
        {alertaTema && (
          <div className="flex flex-col">
            <AlertaSecretarioBox t={alertaTema} />
          </div>
        )}
      </div>

      {/* Gráfico de variação divergente */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">
            {metr.label} · variação por tema (janela {janela}d)
          </div>
          <div className="text-[10px] text-txt-3">
            vermelho = subindo · verde = caindo · cinza = estável
          </div>
        </div>
        <ReactECharts
          option={option}
          style={{ height: Math.max(220, movers.length * 30 + 60) }}
          notMerge
        />
      </div>

    </div>
  );
}
