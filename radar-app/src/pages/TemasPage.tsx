import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchDailyThemes,
  fetchNarratives,
  fetchRadar,
  type DailyTheme,
  type Narrative,
  type Post,
} from "@/lib/data";
import { fmtInt } from "@/lib/format";
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

const DIR_ICON: Record<string, string> = { subindo: "▲", estavel: "─", caindo: "▼" };
const DIR_COR: Record<string, string>  = { subindo: "#22C55E", estavel: "#9FB0CC", caindo: "#EF4444" };
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
      className="rounded-xl border p-5"
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

// ── Nuvem de keywords ────────────────────────────────────────────────────────
// Palavras sem valor de orientação para a gestão: conectivos, nomes próprios
// comuns ao contexto político local, e meta-palavras da própria plataforma.
const STOPWORDS = new Set([
  // Conectivos / artigos / preposições / pronomes
  "de","a","o","que","e","do","da","em","um","para","com","uma","os","no","se","na","por","mais",
  "as","dos","como","mas","ao","ele","das","à","seu","sua","ou","quando","muito","nos","já","eu",
  "também","só","pelo","pela","até","isso","ela","entre","depois","sem","mesmo","aos","ter","seus",
  "quem","nas","me","esse","eles","estão","você","tinha","foram","essa","num","nem","suas","meu",
  "às","minha","têm","numa","pelos","elas","havia","seja","qual","será","nós","tenho","lhe","deles",
  "essas","esses","pelas","este","fosse","dele","tu","te","vocês","vos","lhes","meus","minhas","teu",
  "tua","teus","tuas","nosso","nossa","nossos","nossas","dela","delas","esta","estes","estas","aquele",
  "aquela","aqueles","aquelas","isto","aquilo","estou","está","estamos","estavam","estarão","estaria",
  "foi","ser","tem","são","sendo","tudo","todo","todos","toda","todas","outro","outra","outros","outras",
  "quer","vai","vão","pode","podem","fazer","feito","ainda","então","agora","aqui","ali","lá",
  "bem","há","aí","nada","faz","diz","pois","pra","porque","sobre","apenas","sim","não","né","tá",
  "cada","essa","esse","isso","aqui","eles","elas","mais","muito","menos","mesmo","tanto","tanta",
  "esse","essa","esses","essas","qual","quais","cujo","cuja","cujos","cujas","onde","quando","como",
  // Meta-palavras da plataforma (não são temas de gestão)
  "post","posts","comentario","comentarios","comentários","narrativa","narrativas","resumo",
  "engajamento","alcance","imagem","opositor","opositores","opositora","cidadao","cidadaos",
  "cidadão","cidadãos","perfil","perfis","publicacao","publicacoes","publicação","publicações",
  "analise","análise","radar","politico","político","monitoramento","sentimento","sentimentos",
  // Nomes próprios frequentes no contexto local (não orientam ação da gestão)
  "gustavo","carmo","almeida","jaldice","luciano","nunes","joao","joão","andrelino","jose","josé",
  "nunes","eliene","fabricio","fabrício","israel","isaias","isaque","marcos","pedro","paulo","maria",
  "silva","santos","lima","costa","souza","oliveira","ferreira","pereira","ribeiro","rocha",
  // Adjetivos e substantivos genéricos sem ação de gestão
  "municipal","municipais","pública","público","publico","publica","social","sociais","nacional",
  "local","regional","geral","gerais","cidades","cidade","estado","federal","governo","governos",
  "dias","horas","anos","meses","semana","semanas","hoje","ontem","amanha","amanhã","tempo","vez",
  "vezes","parte","partes","caso","casos","tipo","tipos","forma","formas","modo","modos","area","área",
  "evento","eventos","acao","ações","acao","noticia","noticias","notícia","notícias","critica","crítica",
  "positivo","negativo","positivos","negativos","neutro","neutros","critico","crítico","grave",
  "contra","favor","junto","ainda","antes","depois","sempre","nunca","jamais","talvez",
  "enquanto","durante","mediante","conforme","segundo","terceiro","quarto","quinto",
  "comunicacao","comunicação","programa","programas","iniciativa","iniciativas","projeto","projetos",
  "crise","crises","problema","problemas","solucao","solução","soluções","questao","questão",
  "prefeito","prefeitura","secretaria","secretario","secretário","vereador","vereadores",
]);

function extrairKeywords(posts: Post[]): { palavra: string; count: number; cor: string }[] {
  const freq: Record<string, { pos: number; neg: number; tot: number }> = {};
  for (const p of posts) {
    const texto = [p.resumo, p.queixa_dominante, p.elogio_dominante, p.tema].filter(Boolean).join(" ");
    const sent = p.sentimento_post === "positivo" ? "pos" : p.sentimento_post === "negativo" ? "neg" : null;
    for (const raw of texto.split(/[\s,;:.!?()"'«»\-–—\/]+/)) {
      const w = raw.toLowerCase().replace(/[^a-záàâãéêíóôõúüçñ]/g, "");
      if (w.length < 5 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      freq[w] ??= { pos: 0, neg: 0, tot: 0 };
      freq[w].tot++;
      if (sent === "pos") freq[w].pos++;
      if (sent === "neg") freq[w].neg++;
    }
  }
  return Object.entries(freq)
    .filter(([, v]) => v.tot >= 4)
    .sort((a, b) => b[1].tot - a[1].tot)
    .slice(0, 30)
    .map(([palavra, v]) => {
      let cor = "#9FB0CC";
      if (v.pos > v.neg * 1.5) cor = "#22C55E";
      else if (v.neg > v.pos * 1.5) cor = "#EF4444";
      return { palavra, count: v.tot, cor };
    });
}

function KeywordCloud({ posts }: { posts: Post[] }) {
  const kws = useMemo(() => extrairKeywords(posts), [posts]);
  if (kws.length === 0) return null;
  const max = kws[0].count;
  const min = kws.at(-1)?.count ?? 1;
  const escala = (c: number) => {
    const t = max === min ? 0.5 : (c - min) / (max - min);
    return 0.75 + t * 1.5;
  };
  const top5neg = kws.filter((k) => k.cor === "#EF4444").slice(0, 5);
  const top5pos = kws.filter((k) => k.cor === "#22C55E").slice(0, 5);
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-3 text-sm font-bold">Palavras mais frequentes</div>
      <div className="flex flex-wrap gap-2 leading-relaxed">
        {kws.map(({ palavra, count, cor }) => (
          <span
            key={palavra}
            title={`${count} ocorrência${count > 1 ? "s" : ""}`}
            className="cursor-default transition-opacity hover:opacity-80"
            style={{ fontSize: `${escala(count)}rem`, color: cor, fontWeight: count >= max * 0.6 ? 700 : 500 }}
          >
            {palavra}
          </span>
        ))}
      </div>
      {(top5neg.length > 0 || top5pos.length > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-3">
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-risk-crit">Negativos</div>
            {top5neg.map((k) => (
              <div key={k.palavra} className="flex justify-between py-0.5 text-xs">
                <span className="capitalize text-txt-1">{k.palavra}</span>
                <span className="tabular-nums text-txt-3">{k.count}×</span>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-risk-low">Positivos</div>
            {top5pos.map((k) => (
              <div key={k.palavra} className="flex justify-between py-0.5 text-xs">
                <span className="capitalize text-txt-1">{k.palavra}</span>
                <span className="tabular-nums text-txt-3">{k.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const { data: radarData } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  const posts = radarData?.data ?? [];

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

  const corSlope = (s: number) => (s > 0.1 ? "#22C55E" : s < -0.1 ? "#EF4444" : "#9FB0CC");

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
        return `<b>${ps[0].name}</b><br/>${dir}: ${v > 0 ? "+" : ""}${v.toFixed(1)}/dia`;
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

      {/* Subindo / Caindo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-low">
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
                  <span className="tnum font-bold" style={{ color: isOut ? COR_OUTROS : "#22C55E" }}>
                    +{s.s.toFixed(1)}/dia
                  </span>
                </div>
              );
            })}
            {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-crit">
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
                  <span className="tnum font-bold" style={{ color: isOut ? COR_OUTROS : "#EF4444" }}>
                    {s.s.toFixed(1)}/dia
                  </span>
                </div>
              );
            })}
            {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
          </div>
        </div>
      </div>

      {/* Box de alerta para a secretaria mais crítica */}
      {alertaTema && <AlertaSecretarioBox t={alertaTema} />}

      {/* Gráfico de variação divergente */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">
            {metr.label} · variação por tema (janela {janela}d)
          </div>
          <div className="text-[10px] text-txt-3">
            verde = subindo · vermelho = caindo · cinza = estável
          </div>
        </div>
        <ReactECharts
          option={option}
          style={{ height: Math.max(220, movers.length * 30 + 60) }}
          notMerge
        />
      </div>

      {/* Nuvem de keywords */}
      {posts.length > 0 && <KeywordCloud posts={posts} />}

      {/* Tabela de todos os temas */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-3 text-sm font-bold">Todos os temas</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-[11px] uppercase tracking-wide text-txt-3">
              <tr>
                <th className="py-2 text-left font-semibold">Tema</th>
                <th className="py-2 text-right font-semibold">Total</th>
                <th className="py-2 text-right font-semibold">Último</th>
                <th className="py-2 text-right font-semibold">Tendência</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const dir    = direcao(s.s);
                const isOut  = outrosTemasSet.has(s.tema);
                return (
                  <tr key={s.tema} className="border-b border-line/40">
                    <td className="py-2 text-txt-1">
                      {isOut && (
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: COR_OUTROS }}
                          title="Incluso em Outros"
                        />
                      )}
                      {s.tema}
                    </td>
                    <td className="tnum py-2 text-right text-txt-2">{fmtInt(s.total)}</td>
                    <td className="tnum py-2 text-right text-txt-2">{fmtInt(s.ultimo)}</td>
                    <td
                      className="tnum py-2 text-right font-bold"
                      style={{ color: DIR_COR[dir] }}
                    >
                      {DIR_ICON[dir]} {Math.abs(s.s).toFixed(1)}/dia
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
