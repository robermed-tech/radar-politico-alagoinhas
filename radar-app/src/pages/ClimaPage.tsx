import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, fetchBoletimByRole, fetchBriefing, fetchCrisisPlans, filtrarPorPeriodo, parseData, type Post, type Boletim, type BoletimFrente, type Briefing, type CrisisPlan } from "@/lib/data";
import { calcIAD, distribuicao, NIVEL_COLOR, NIVEL_LABEL, type NivelCrise } from "@/lib/indices";
import { getWeather, weatherFromCondicao } from "@/lib/weather";
import { fmtInt } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde",
  educacao: "Educação",
  obras: "Obras e Infraestrutura",
  seguranca: "Segurança Pública",
  transporte: "Transporte",
  emprego: "Emprego e Economia",
  impostos: "Impostos e Tributos",
  saneamento: "Saneamento (Água/Esgoto)",
  cultura_eventos: "Cultura e Eventos",
  comunicacao: "Comunicação e Transparência",
};

function somarComents(posts: Post[]): { neg: number; pos: number; neu: number } {
  let neg = 0, pos = 0;
  let total = 0;
  for (const p of posts) {
    const tot = p.comentarios_total || 0;
    total += tot;
    neg += Math.round(((p.comentarios_pct_neg || 0) / 100) * tot);
    pos += Math.round(((p.comentarios_pct_pos || 0) / 100) * tot);
  }
  return { neg, pos, neu: Math.max(0, total - neg - pos) };
}

function TabelaComentarios({ allPosts }: { allPosts: Post[] }) {
  const periodos = [
    { label: "Hoje (24h)", posts: filtrarPorPeriodo(allPosts, 1) },
    { label: "Esta semana", posts: filtrarPorPeriodo(allPosts, 7) },
    { label: "Este mês", posts: filtrarPorPeriodo(allPosts, 30) },
  ];

  const posts30 = filtrarPorPeriodo(allPosts, 30);
  const byTema: Record<string, Post[]> = {};
  for (const p of posts30) {
    const tema = (p.tema || "").toLowerCase().trim();
    if (!TEMA_LABEL[tema]) continue;
    (byTema[tema] ??= []).push(p);
  }
  const temas = Object.entries(byTema)
    .map(([tema, ps]) => ({ tema, ...somarComents(ps) }))
    .filter((t) => t.neg + t.pos + t.neu > 0)
    .sort((a, b) => b.neg - a.neg);

  const thCls = "pb-2 text-[10px] font-bold uppercase tracking-wide";
  const tdCls = "py-2.5 tnum";

  return (
    <div className="rounded-[28px] border border-line bg-bg-1 p-6 space-y-6">
      <div className="text-[12px] font-bold tracking-[0.04em] text-txt-3">
        Volume de comentários por período e tema
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-txt-3">Por período</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th className={`${thCls} text-left text-txt-3`}>Período</th>
                <th className={`${thCls} text-right text-risk-crit`}>Negativos</th>
                <th className={`${thCls} text-right`} style={{ color: "#84A800" }}>Positivos</th>
                <th className={`${thCls} text-right text-txt-3`}>Neutros</th>
                <th className={`${thCls} text-right text-txt-2`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {periodos.map(({ label, posts }) => {
                const { neg, pos, neu } = somarComents(posts);
                return (
                  <tr key={label} className="border-b border-line/30 last:border-0">
                    <td className={`${tdCls} text-txt-1 font-medium`}>{label}</td>
                    <td className={`${tdCls} text-right font-bold text-risk-crit`}>{fmtInt(neg)}</td>
                    <td className={`${tdCls} text-right font-bold`} style={{ color: "#84A800" }}>{fmtInt(pos)}</td>
                    <td className={`${tdCls} text-right text-txt-3`}>{fmtInt(neu)}</td>
                    <td className={`${tdCls} text-right text-txt-2`}>{fmtInt(neg + pos + neu)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {temas.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-txt-3">Por tema — últimos 30 dias</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${thCls} text-left text-txt-3`}>Tema</th>
                  <th className={`${thCls} text-right text-risk-crit`}>Negativos</th>
                  <th className={`${thCls} text-right`} style={{ color: "#84A800" }}>Positivos</th>
                  <th className={`${thCls} text-right text-txt-3`}>Neutros</th>
                  <th className={`${thCls} text-right text-txt-2`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {temas.map(({ tema, neg, pos, neu }) => (
                  <tr key={tema} className="border-b border-line/30 last:border-0">
                    <td className={`${tdCls} text-txt-1 font-medium`}>{TEMA_LABEL[tema]}</td>
                    <td className={`${tdCls} text-right font-bold text-risk-crit`}>{fmtInt(neg)}</td>
                    <td className={`${tdCls} text-right font-bold`} style={{ color: "#84A800" }}>{fmtInt(pos)}</td>
                    <td className={`${tdCls} text-right text-txt-3`}>{fmtInt(neu)}</td>
                    <td className={`${tdCls} text-right text-txt-2`}>{fmtInt(neg + pos + neu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const PERIODOS = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

function forcaAmostra(comentarios: number): { label: string; nivel: number } {
  if (comentarios >= 300) return { label: "Amostra forte", nivel: 3 };
  if (comentarios >= 100) return { label: "Boa amostra", nivel: 2 };
  if (comentarios >= 30) return { label: "Amostra inicial", nivel: 1 };
  return { label: "Amostra pequena", nivel: 0 };
}

function scoreParaNivel(score: number): NivelCrise {
  if (score >= 75) return "critico";
  if (score >= 55) return "alto";
  if (score >= 35) return "moderado";
  return "baixo";
}

// No boletim público (usuário comum) o score numérico das frentes é removido;
// derivamos o nível pelo ícone (já calculado no backend), sem expor número.
const ICONE_TO_NIVEL: Record<string, NivelCrise> = {
  sol: "baixo", nuvem: "moderado", chuva: "alto", tempestade: "critico",
};
function frenteNivel(f: BoletimFrente): NivelCrise {
  if (typeof f.score === "number") return scoreParaNivel(f.score);
  return ICONE_TO_NIVEL[f.icone] ?? "moderado";
}

// Título e rótulo do diagnóstico variam conforme o período selecionado.
function periodoTitulo(dias: number): string {
  if (dias <= 1) return "Previsão do dia";
  if (dias <= 7) return "Clima da semana";
  return "Clima do mês";
}
function periodoClima(dias: number): string {
  if (dias <= 1) return "análise do clima do dia";
  if (dias <= 7) return "análise do clima da semana";
  return "análise do clima do mês";
}

// Frente de instabilidade → classe de clima usada pelo WeatherIcon.
const FRENTE_TO_CLS: Record<string, string> = {
  sol: "sunny",
  nuvem: "cloudy",
  chuva: "rain",
  tempestade: "storm",
};

// Ícone de clima minimalista (linha, estilo sidebar) — substitui os emojis.
function WeatherIcon({ cls, size = 64, color = "currentColor", strokeWidth = 1.5 }: {
  cls: string; size?: number; color?: string; strokeWidth?: number;
}) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (cls) {
    case "sunny":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </svg>
      );
    case "partly":
      return (
        <svg {...p}>
          <circle cx="8.5" cy="7.5" r="3" />
          <path d="M8.5 1.8v1.4M2.9 7.5H1.5M3.9 2.9l1 1M14.1 2.9l-1 1" />
          <path d="M7 19h9.2a3.4 3.4 0 0 0 .3-6.8A5 5 0 0 0 7 13.4 3.3 3.3 0 0 0 7 19z" />
        </svg>
      );
    case "cloudy":
      return (
        <svg {...p}>
          <path d="M7 18h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 11.6 3.8 3.8 0 0 0 7 18z" />
        </svg>
      );
    case "rain":
      return (
        <svg {...p}>
          <path d="M7 14h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 7.6 3.8 3.8 0 0 0 7 14z" />
          <path d="M8.5 17.5l-1 3M12 17.5l-1 3M15.5 17.5l-1 3" />
        </svg>
      );
    case "storm":
      return (
        <svg {...p}>
          <path d="M7 14h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 7.6 3.8 3.8 0 0 0 7 14z" />
          <path d="M12.5 15l-2.5 4h3l-2.5 4.5" />
        </svg>
      );
    default: // severe
      return (
        <svg {...p}>
          <path d="M7 13h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 6.6 3.8 3.8 0 0 0 7 13z" />
          <path d="M8 16.5l-1 3M16 16.5l-1 3M12.5 14l-2 3.5h3L11 21" />
        </svg>
      );
  }
}

// Ícones minimalistas inline (linha) usados nos chips do hero.
function IconPosts({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="5" y1="20" x2="5" y2="13" /><line x1="12" y1="20" x2="12" y2="7" /><line x1="19" y1="20" x2="19" y2="10" />
    </svg>
  );
}
function IconVozes({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function DiagnosticoCard({ briefing, dias }: { briefing: Briefing; dias: number }) {
  const nivel = (briefing.nivel_crise as NivelCrise) ?? "baixo";
  const cor = NIVEL_COLOR[nivel];
  return (
    <div
      className="rounded-[28px] border bg-bg-1 p-6"
      style={{ borderColor: `${cor}44` }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded-full px-3 py-0.5 text-xs font-bold uppercase"
          style={{ background: `${cor}22`, color: cor }}
        >
          {NIVEL_LABEL[nivel]}
        </span>
        <span className="text-xs text-txt-3">{periodoClima(dias)} · {briefing.dia}</span>
      </div>
      <p className="text-[15px] font-semibold leading-relaxed text-txt-1">{briefing.diagnostico}</p>
    </div>
  );
}

function TemasEmCrise({ alertas }: { alertas: Briefing["alertas"] }) {
  if (!alertas?.length) return null;
  return (
    <div className="rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="mb-3 text-[12px] font-bold tracking-[0.04em] text-txt-3">
        Temas que merecem atenção
      </div>
      <div className="space-y-2">
        {alertas.slice(0, 5).map((a, i) => {
          const cor = NIVEL_COLOR[(a.nivel as NivelCrise) ?? "baixo"];
          const tema = a.tema ? a.tema.charAt(0).toUpperCase() + a.tema.slice(1).toLowerCase() : "";
          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border bg-bg-2 px-4 py-2.5"
              style={{ borderColor: `${cor}33` }}
            >
              <span
                className="shrink-0 rounded px-2.5 py-0.5 text-xs font-bold uppercase"
                style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
              >
                {NIVEL_LABEL[(a.nivel as NivelCrise) ?? "baixo"]}
              </span>
              <span className="font-semibold text-txt-1">{tema}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AcoesImediatas({ planos }: { planos: CrisisPlan[] }) {
  const reais = planos.filter((p) => p.e_crise_real).slice(0, 2);
  if (reais.length === 0) return null;
  return (
    <div
      className="rounded-[28px] border p-6"
      style={{ borderColor: "rgba(249,115,22,0.4)", background: "rgba(249,115,22,0.04)" }}
    >
      <div
        className="mb-3 text-[12px] font-bold tracking-[0.04em]"
        style={{ color: "#F97316" }}
      >
        O que fazer agora
      </div>
      <div className="space-y-3">
        {reais.map((p) => (
          <div key={p.post_url} className="rounded-lg border border-line bg-bg-1 p-4">
            {p.tema && (
              <div className="mb-1 text-sm font-extrabold capitalize text-txt-1">{p.tema}</div>
            )}
            <p className="text-sm text-txt-2">
              <span className="font-semibold text-orange-400">O que disparou: </span>
              {p.pavio}
            </p>
            {p.plano_contencao?.[0] && (
              <p className="mt-1.5 text-sm text-txt-1">
                <span className="font-semibold" style={{ color: "#22C55E" }}>→ </span>
                {p.plano_contencao[0]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FrentesInstabilidade({ frentes }: { frentes: Boletim["frentes"] }) {
  if (!frentes.length) return null;
  return (
    <div className="rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="text-[12px] font-bold tracking-[0.04em] text-txt-3">
        Frentes de instabilidade
      </div>
      <div className="mt-3 space-y-1">
        {frentes.filter((f) => f.tema !== "outros").map((f) => {
          const nivel = frenteNivel(f);
          const cor = NIVEL_COLOR[nivel];
          return (
            <div key={f.tema} className="flex items-center justify-between py-1 text-sm">
              <span className="flex items-center gap-2 text-txt-1">
                <span className="text-txt-3"><WeatherIcon cls={FRENTE_TO_CLS[f.icone] ?? "cloudy"} size={18} strokeWidth={1.6} /></span>
                {f.tema}
              </span>
              <span
                className="rounded px-2.5 py-0.5 text-xs font-bold uppercase"
                style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
              >
                {NIVEL_LABEL[nivel]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildSparkline(posts: Post[]): { dia: string; iad: number }[] {
  const byDay: Record<string, Post[]> = {};
  for (const p of posts) {
    const d = parseData(p.data_post);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    (byDay[key] ??= []).push(p);
  }
  return Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, ps]) => ({ dia, iad: Math.round(calcIAD(ps)) }));
}

function SparklineIAD({ pontos, media }: { pontos: { dia: string; iad: number }[]; media?: number }) {
  if (pontos.length < 2) return <div className="text-xs text-txt-3">Dados insuficientes para tendência.</div>;
  const W = 240, H = 52, PAD = 4;
  const vals = pontos.map((p) => p.iad);
  const lo = Math.max(0, Math.min(...vals) - 8);
  const hi = Math.min(100, Math.max(...vals) + 8);
  const rng = hi - lo || 1;
  const xp = (i: number) => PAD + (i / (pontos.length - 1)) * (W - PAD * 2);
  const yp = (v: number) => PAD + (1 - (v - lo) / rng) * (H - PAD * 2);
  const pts = pontos.map((p, i) => ({ x: xp(i), y: yp(p.iad) }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;
  const last = pontos[pontos.length - 1];
  const ref = pontos.length >= 7 ? pontos[pontos.length - 7].iad : pontos[0].iad;
  const delta = last.iad - ref;
  const arrow = delta > 2 ? "↑" : delta < -2 ? "↓" : "→";
  const arrowColor = delta > 2 ? "#22C55E" : delta < -2 ? "#EF4444" : "#64748B";
  const headline = media ?? last.iad;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="tnum text-3xl font-extrabold text-txt-1">{headline}%</span>
        <span className="text-sm font-bold" style={{ color: arrowColor }}>
          {arrow} {Math.abs(delta)}pt vs 7d
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="iad-spk-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#iad-spk-grad)" />
        <path d={line} fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill="#F97316" />
      </svg>
      <div className="text-[10px] text-txt-3">{pontos.length} dias com dados · últimos 30 dias</div>
    </div>
  );
}

function BarrasDistribuicao({ pctPos, pctNeu }: { pctPos: number; pctNeu: number }) {
  const N = 34;
  const limPos = pctPos / 100;
  const limNeu = (pctPos + pctNeu) / 100;
  return (
    <div className="flex h-16 items-end gap-[3px]">
      {Array.from({ length: N }).map((_, i) => {
        const frac = i / N;
        const cor = frac < limPos ? "#BEDB1D" : frac < limNeu ? "#64748B" : "#EF4444";
        const h = 45 + Math.round(40 * Math.abs(Math.sin(i * 0.9)));
        return (
          <span
            key={i}
            className="flex-1 rounded-full"
            style={{ height: `${h}%`, background: cor, opacity: cor === "#64748B" ? 0.35 : 0.95 }}
          />
        );
      })}
    </div>
  );
}

export function ClimaPage() {
  const [dias, setDias] = useState(1);
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  const { data: boletim } = useQuery({
    queryKey: ["boletim", isAdmin],
    queryFn: () => fetchBoletimByRole(isAdmin),
    staleTime: 5 * 60 * 1000,
  });
  const { data: briefing } = useQuery({
    queryKey: ["briefing"],
    queryFn: fetchBriefing,
    staleTime: 5 * 60 * 1000,
  });
  const { data: planosData } = useQuery({
    queryKey: ["crisis-plans"],
    queryFn: fetchCrisisPlans,
    staleTime: 5 * 60 * 1000,
  });
  const planos = planosData ?? [];

  const view = useMemo(() => {
    if (!data) return null;
    const posts = filtrarPorPeriodo(data.data, dias);
    if (posts.length === 0) return { vazio: true } as const;
    const iad = Math.round(calcIAD(posts));
    const dist = distribuicao(posts);
    const wx = getWeather(iad);
    const totalComents = posts.reduce((s, p) => s + (p.comentarios_total || 0), 0);
    const posts30 = filtrarPorPeriodo(data.data, 30);
    const sparkline = buildSparkline(posts30);
    const iad30 = Math.round(calcIAD(posts30));
    return {
      vazio: false as const,
      iad, iad30, ...dist,
      wx,
      posts: posts.length,
      comentarios: totalComents,
      sparkline,
    };
  }, [data, dias]);

  if (isLoading) return <div className="p-8 text-txt-2">Lendo o clima político…</div>;
  if (!view) return null;

  if (view.vazio)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">{periodoTitulo(dias)}</h1>
        <div className="mt-4 rounded-[28px] border border-line bg-bg-1 p-6 text-txt-2">
          Sem dados no período. Rode o AGORA para popular.
        </div>
      </div>
    );

  // Admin vê o clima derivado do score (client). Usuário comum vê a condição
  // que vem pronta do boletim (backend) — sem o número.
  const wx = isAdmin ? view.wx : weatherFromCondicao(boletim?.condicao);
  const txt1 = "#FFFFFF";
  const txt2 = "rgba(255,255,255,0.86)";
  const heroBg = `linear-gradient(105deg, rgba(8,11,18,0.72) 0%, rgba(8,11,18,0.32) 50%, rgba(8,11,18,0.58) 100%), url("${wx.image}") center/cover no-repeat, ${wx.bg}`;
  const amostra = forcaAmostra(view.comentarios);

  return (
    <div className="space-y-4 p-5">
      <div className="reveal reveal-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">{periodoTitulo(dias)}</h1>
          <p className="text-base text-txt-2">Alagoinhas/BA · imagem do prefeito e da prefeitura</p>
        </div>
        <div className="flex rounded-full p-1 glass-btn">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
                dias === p.dias ? "bg-white/25 text-txt-1 shadow-sm" : "text-txt-2 hover:text-txt-1"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div
          className="reveal reveal-2 relative overflow-hidden rounded-[28px] p-7 lg:col-span-3"
          style={{ background: heroBg, minHeight: 320 }}
        >
          {(wx.cls === "rain" || wx.cls === "storm" || wx.cls === "severe") && (
            <div className="rain-layer">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="raindrop"
                  style={{
                    left: `${(i * 4.3) % 100}%`,
                    animationDuration: `${0.55 + (i % 5) * 0.12}s`,
                    animationDelay: `${-(i % 7) * 0.2}s`,
                  }}
                />
              ))}
            </div>
          )}

          <div className="relative z-10 flex h-full flex-col">
            <div className="text-[13px] font-bold tracking-[0.08em]" style={{ color: txt2 }}>
              Como a população vê a gestão
            </div>

            <div className="mt-5 flex items-center gap-6">
              <div style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.22))" }}>
                <WeatherIcon cls={wx.cls} size={88} color="#FFFFFF" strokeWidth={1.4} />
              </div>
              <div>
                {isAdmin ? (
                  <div className="flex items-end gap-1">
                    <span className="tnum text-[60px] leading-[0.85] tracking-tight sm:text-[84px]" style={{ color: txt1, fontWeight: 200 }}>
                      {view.iad}
                    </span>
                    <span className="mb-3 text-2xl font-bold" style={{ color: txt2 }}>%</span>
                  </div>
                ) : (
                  <div className="text-[40px] font-extrabold leading-[1.0] tracking-tight" style={{ color: txt1 }}>
                    {wx.label}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 max-w-xl text-lg font-semibold leading-snug" style={{ color: txt1 }}>
              {wx.sub}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
              >
                <IconPosts /> {fmtInt(view.posts)} publicações analisadas
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
              >
                <IconVozes /> {fmtInt(view.comentarios)} vozes ouvidas
              </span>
            </div>
          </div>
        </div>

        <div
          className="reveal reveal-3 relative overflow-hidden rounded-[28px] p-7 lg:col-span-2"
          style={{
            background: "linear-gradient(150deg, #FB923C 0%, #EA580C 100%)",
            minHeight: 320,
            boxShadow: "0 18px 40px -14px rgba(234,88,12,0.5)",
          }}
        >
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
            style={{ background: "rgba(255,255,255,0.12)" }}
          />
          <div className="relative z-10 flex h-full flex-col">
            <div className="text-[13px] font-bold tracking-[0.08em] text-white/80">
              Engajamento no período
            </div>
            <p className="mt-2 max-w-[22ch] text-base font-medium leading-snug text-white/90">
              Quanto mais vozes ouvidas, mais confiável é a leitura do clima.
            </p>

            <div
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold"
              style={{ background: "#BEDB1D", color: "#1A2400" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="6" y1="20" x2="6" y2="15" />
                <line x1="12" y1="20" x2="12" y2={amostra.nivel >= 2 ? "9" : "13"} style={{ opacity: amostra.nivel >= 1 ? 1 : 0.3 }} />
                <line x1="18" y1="20" x2="18" y2="5" style={{ opacity: amostra.nivel >= 3 ? 1 : 0.3 }} />
              </svg>
              {amostra.label}
            </div>

            <div className="mt-auto pt-6">
              <div className="flex items-end gap-1">
                <span className="tnum text-[68px] leading-[0.85] tracking-tight text-white" style={{ fontWeight: 200 }}>
                  {fmtInt(view.comentarios)}
                </span>
              </div>
              <div className="mt-1 text-base font-semibold text-white/85">
                vozes ouvidas · {fmtInt(view.posts)} publicações
              </div>
            </div>
          </div>
        </div>
      </div>

      {briefing && <DiagnosticoCard briefing={briefing} dias={dias} />}

      {briefing?.alertas?.length ? (
        <TemasEmCrise alertas={briefing.alertas} />
      ) : (
        boletim?.frentes && boletim.frentes.length > 0 && (
          <FrentesInstabilidade frentes={boletim.frentes} />
        )
      )}

      <AcoesImediatas planos={planos} />

      <div className="reveal reveal-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-[28px] border border-line bg-bg-1 p-6">
          <div className="text-[12px] font-bold tracking-[0.04em] text-txt-3">
            Distribuição de sentimento
          </div>

          <div className="mt-4">
            <BarrasDistribuicao pctPos={view.pctPos} pctNeu={view.pctNeu} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
            <div>
              <div className="tnum text-2xl font-extrabold" style={{ color: "#84A800" }}>{view.pctPos}%</div>
              <div className="text-xs text-txt-3">Favorável</div>
            </div>
            <div>
              <div className="tnum text-2xl font-extrabold" style={{ color: "#64748B" }}>{view.pctNeu}%</div>
              <div className="text-xs text-txt-3">Sem posição</div>
            </div>
            <div>
              <div className="tnum text-2xl font-extrabold text-risk-crit">{view.pctNeg}%</div>
              <div className="text-xs text-txt-3">Crítico</div>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div
            className="rounded-[28px] border p-6"
            style={{ borderColor: "rgba(249,115,22,0.35)", background: "rgba(249,115,22,0.05)" }}
          >
            <div className="text-[12px] font-bold tracking-[0.04em]" style={{ color: "#F97316" }}>
              Aprovação digital — últimos 30 dias
            </div>
            <div className="mt-3">
              <SparklineIAD pontos={view.sparkline} media={view.iad30} />
            </div>
          </div>
        )}
      </div>

      <TabelaComentarios allPosts={data!.data} />
    </div>
  );
}
