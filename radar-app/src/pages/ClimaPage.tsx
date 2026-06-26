import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, fetchBoletim, filtrarPorPeriodo, parseData, type Post, type Boletim, type BoletimAlerta } from "@/lib/data";
import { calcIAD, distribuicao } from "@/lib/indices";
import { getWeather, getDestaque } from "@/lib/weather";
import { fmtInt } from "@/lib/format";

const PERIODOS = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

function temaDominante(posts: Post[]): string {
  const c: Record<string, number> = {};
  posts.forEach((p) => { if (p.tema) c[p.tema] = (c[p.tema] || 0) + 1; });
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : "";
}

/** Rótulo qualitativo da amostra — linguagem para não-especialistas. */
function forcaAmostra(comentarios: number): { label: string; emoji: string } {
  if (comentarios >= 300) return { label: "Amostra forte", emoji: "👍" };
  if (comentarios >= 100) return { label: "Boa amostra", emoji: "🙂" };
  if (comentarios >= 30) return { label: "Amostra inicial", emoji: "🌱" };
  return { label: "Amostra pequena", emoji: "🔎" };
}

// ── Boletim: cores por nível e ícones de frente (mesma metáfora do Clima) ──
const COR_NIVEL: Record<string, string> = {
  amarelo: "#EAB308",
  laranja: "#EA580C",
  vermelho: "#EF4444",
};
const ICONE_FRENTE: Record<string, string> = {
  sol: "☀️",
  nuvem: "☁️",
  chuva: "🌧️",
  tempestade: "⛈️",
};
const SETA_TEND: Record<string, string> = { subindo: "▲", estavel: "▬", caindo: "▼" };

/** Faixa de alerta SCCT — só aparece quando há crise no boletim. */
function AlertaSCCT({ alerta, nivelCor }: { alerta: BoletimAlerta; nivelCor: string | null }) {
  const [aberto, setAberto] = useState(false);
  const cor = COR_NIVEL[nivelCor ?? "laranja"] ?? COR_NIVEL.laranja;
  const { scct } = alerta;
  return (
    <div
      className="rounded-[28px] border bg-bg-1 p-6"
      style={{ borderColor: cor, borderWidth: 1.5 }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-extrabold text-txt-1">
          <span style={{ color: cor }}>⚠</span>
          Alerta localizado: "{temaDoMotivo(alerta)}"
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-bold"
          style={{ background: `${cor}22`, color: cor }}
        >
          {scct.rotulo_cluster} · {scct.rotulo_responsabilidade}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-txt-2">{alerta.motivo}</p>

      <div className="mt-4 border-t border-line pt-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">
          Recomendação
        </div>
        <p className="mt-1 text-sm font-medium leading-relaxed text-txt-1">
          {alerta.recomendacao_irt}
        </p>

        {aberto && alerta.por_que_funciona && (
          <p className="mt-2 text-sm leading-relaxed text-txt-2">
            <span className="font-bold">Por que funciona: </span>
            {alerta.por_que_funciona}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {alerta.url_post && (
            <a
              href={alerta.url_post}
              target="_blank"
              rel="noreferrer"
              className="glass-btn rounded-full px-4 py-1.5 text-sm font-semibold text-txt-1"
            >
              Ver post ↗
            </a>
          )}
          {alerta.por_que_funciona && (
            <button
              onClick={() => setAberto((v) => !v)}
              className="glass-btn rounded-full px-4 py-1.5 text-sm font-semibold text-txt-1"
            >
              {aberto ? "Ocultar detalhe" : "Detalhar classificação"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Extrai o tema citado na frase do boletim (entre aspas), com fallback. */
function temaDoMotivo(alerta: BoletimAlerta): string {
  const m = alerta.motivo.match(/"([^"]+)"/);
  return m ? m[1] : "tema em alta";
}

/** Frentes de instabilidade — temas ranqueados por risco. */
function FrentesInstabilidade({ frentes }: { frentes: Boletim["frentes"] }) {
  if (!frentes.length) return null;
  return (
    <div className="rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">
        Frentes de instabilidade
      </div>
      <div className="mt-3 space-y-1">
        {frentes.map((f) => {
          const corSeta =
            f.tendencia === "subindo" ? "var(--risk-crit, #EF4444)"
            : f.tendencia === "caindo" ? "var(--risk-low, #22C55E)"
            : "var(--txt3)";
          return (
            <div key={f.tema} className="flex items-center justify-between py-1 text-sm">
              <span className="flex items-center gap-2 text-txt-1">
                <span>{ICONE_FRENTE[f.icone] ?? "☁️"}</span>
                {f.tema}
              </span>
              <span className="tnum font-bold" style={{ color: corSeta }}>
                {SETA_TEND[f.tendencia]} {Math.round(f.score)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Agrega posts por dia e retorna IAD diário (últimos 30 dias). */
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

/** Sparkline SVG do IAD nos últimos 30 dias. */
function SparklineIAD({ pontos }: { pontos: { dia: string; iad: number }[] }) {
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
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="tnum text-3xl font-extrabold text-txt-1">{last.iad}%</span>
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

/** Visualização de barras verticais (estilo "Calories" da referência).
 *  Cada barra é colorida pelo segmento de sentimento em que cai. */
function BarrasDistribuicao({ pctPos, pctNeu }: { pctPos: number; pctNeu: number }) {
  const N = 34;
  const limPos = pctPos / 100;
  const limNeu = (pctPos + pctNeu) / 100;
  return (
    <div className="flex h-16 items-end gap-[3px]">
      {Array.from({ length: N }).map((_, i) => {
        const frac = i / N;
        const cor = frac < limPos ? "#BEDB1D" : frac < limNeu ? "#64748B" : "#EF4444";
        // altura levemente orgânica para dar vida ao gráfico
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
  const [dias, setDias] = useState(1); // padrão 24h (era 7 dias)
  const { data, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  // Boletim climático (camada SCCT). Independente do fetchRadar — não bloqueia o hero.
  const { data: boletim } = useQuery({
    queryKey: ["boletim"],
    queryFn: fetchBoletim,
    staleTime: 5 * 60 * 1000,
  });

  const view = useMemo(() => {
    if (!data) return null;
    const posts = filtrarPorPeriodo(data.data, dias);
    if (posts.length === 0) return { vazio: true } as const;
    const iad = Math.round(calcIAD(posts));
    const dist = distribuicao(posts);
    const wx = getWeather(iad);
    const totalComents = posts.reduce((s, p) => s + (p.comentarios_total || 0), 0);
    const sparkline = buildSparkline(filtrarPorPeriodo(data.data, 30));
    return {
      vazio: false as const,
      iad, ...dist,
      wx,
      destaque: getDestaque(iad, temaDominante(posts)),
      temaTop: temaDominante(posts),
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
        <h1 className="text-2xl font-extrabold">Clima Político</h1>
        <div className="mt-4 rounded-[28px] border border-line bg-bg-1 p-6 text-txt-2">
          Sem dados no período. Rode o AGORA para popular.
        </div>
      </div>
    );

  const { wx } = view;
  const txt1 = "#FFFFFF";
  const txt2 = "rgba(255,255,255,0.86)";
  const heroBg = `linear-gradient(105deg, rgba(8,11,18,0.72) 0%, rgba(8,11,18,0.32) 50%, rgba(8,11,18,0.58) 100%), url("${wx.image}") center/cover no-repeat, ${wx.bg}`;
  const amostra = forcaAmostra(view.comentarios);

  return (
    <div className="space-y-4 p-5">
      {/* Cabeçalho */}
      <div className="reveal reveal-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Clima Político</h1>
          <p className="text-sm text-txt-2">Alagoinhas/BA · termômetro visual da opinião</p>
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

      {/* ── LINHA HERO: foto do clima (3) + card de engajamento azul (2) ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* HERO — principal box com a foto do clima */}
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
            <div className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: txt2 }}>
              Como está o clima político
            </div>

            <div className="mt-5 flex items-center gap-6">
              <div className="text-[92px] leading-none" style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.22))" }}>
                {wx.icon}
              </div>
              <div>
                <div className="flex items-end gap-1">
                  <span className="tnum text-[84px] leading-[0.85] tracking-tight" style={{ color: txt1, fontWeight: 200 }}>
                    {view.iad}
                  </span>
                  <span className="mb-3 text-2xl font-bold" style={{ color: txt2 }}>%</span>
                </div>
                <div
                  className="mt-1 inline-flex rounded-full px-3 py-1 text-sm font-extrabold"
                  style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
                >
                  {wx.label}
                </div>
              </div>
            </div>

            <div className="mt-5 max-w-xl text-base font-semibold leading-snug" style={{ color: txt1 }}>
              {wx.sub}
            </div>

            {/* chips de fonte — estilo "members" da referência */}
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
              <span
                className="rounded-full px-3 py-1.5 text-xs font-bold"
                style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
              >
                📊 {fmtInt(view.posts)} publicações analisadas
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-bold"
                style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
              >
                💬 {fmtInt(view.comentarios)} vozes ouvidas
              </span>
            </div>
          </div>
        </div>

        {/* CARD LARANJA — engajamento (estilo "Hydration") */}
        <div
          className="reveal reveal-3 relative overflow-hidden rounded-[28px] p-7 lg:col-span-2"
          style={{
            background: "linear-gradient(150deg, #FB923C 0%, #EA580C 100%)",
            minHeight: 320,
            boxShadow: "0 18px 40px -14px rgba(234,88,12,0.5)",
          }}
        >
          {/* bolha decorativa */}
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
            style={{ background: "rgba(255,255,255,0.12)" }}
          />
          <div className="relative z-10 flex h-full flex-col">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/80">
              Engajamento no período
            </div>
            <p className="mt-2 max-w-[22ch] text-sm font-medium leading-snug text-white/90">
              Quanto mais vozes ouvidas, mais confiável é a leitura do clima.
            </p>

            <div
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold"
              style={{ background: "#BEDB1D", color: "#1A2400" }}
            >
              {amostra.emoji} {amostra.label}
            </div>

            <div className="mt-auto pt-6">
              <div className="flex items-end gap-1">
                <span className="tnum text-[68px] leading-[0.85] tracking-tight text-white" style={{ fontWeight: 200 }}>
                  {fmtInt(view.comentarios)}
                </span>
              </div>
              <div className="mt-1 text-sm font-semibold text-white/85">
                vozes ouvidas · {fmtInt(view.posts)} publicações
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BOLETIM: alerta SCCT (só quando há crise) ── */}
      {boletim?.alerta_ativo && (
        <AlertaSCCT alerta={boletim.alerta_ativo} nivelCor={boletim.nivel_cor} />
      )}

      {/* ── BOLETIM: frentes de instabilidade ── */}
      {boletim?.frentes && boletim.frentes.length > 0 && (
        <FrentesInstabilidade frentes={boletim.frentes} />
      )}

      {/* ── LINHA DE 3 CARDS (estilo referência: Sleep / Calories / Weight) ── */}
      <div className="reveal reveal-4 grid gap-4 md:grid-cols-3">
        {/* Card 1 — O que a população diz agora */}
        <div className="rounded-[28px] border border-line bg-bg-1 p-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">
            O que a população diz agora
          </div>
          {view.temaTop && (
            <div
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white"
              style={{ background: "#0B1220" }}
            >
              🏷 {view.temaTop}
            </div>
          )}
          <p className="mt-3 text-[15px] font-semibold leading-snug text-txt-1">
            {view.destaque}
          </p>
        </div>

        {/* Card 2 — Distribuição (estilo "Calories" com barras) */}
        <div className="rounded-[28px] border border-line bg-bg-1 p-6">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">
              Distribuição
            </div>
            <span className="tnum text-sm font-bold text-txt-2">{view.iad}% aprovação</span>
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

        {/* Card 3 — Tendência do IAD (sparkline 30 dias) */}
        <div className="rounded-[28px] border border-line bg-bg-1 p-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">
            Tendência 30 dias
          </div>
          <div className="mt-3">
            <SparklineIAD pontos={view.sparkline} />
          </div>
        </div>
      </div>
    </div>
  );
}
