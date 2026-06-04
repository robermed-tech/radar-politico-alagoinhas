import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, filtrarPorPeriodo, type Post } from "@/lib/data";
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

export function ClimaPage() {
  const [dias, setDias] = useState(7);
  const { data, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
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
    return {
      vazio: false as const,
      iad, ...dist,
      wx,
      destaque: getDestaque(iad, temaDominante(posts)),
      posts: posts.length,
      comentarios: totalComents,
    };
  }, [data, dias]);

  if (isLoading) return <div className="p-8 text-txt-2">Lendo o clima político…</div>;
  if (!view) return null;

  if (view.vazio)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Clima Político</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Sem dados no período. Rode o AGORA para popular.
        </div>
      </div>
    );

  const { wx } = view;
  // Texto do HERO depende da luminosidade do gradiente do hero (não do app)
  const txt1 = wx.heroDark ? "#FFFFFF" : "#0B1220";
  const txt2 = wx.heroDark ? "rgba(255,255,255,0.82)" : "rgba(11,18,32,0.66)";

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Clima Político</h1>
          <p className="text-sm text-txt-2">Alagoinhas/BA · termômetro visual da opinião</p>
        </div>
        <div className="flex rounded-lg p-1 glass-btn">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                dias === p.dias ? "bg-white/20 text-txt-1" : "text-txt-2 hover:text-txt-1"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* HERO do clima */}
      <div
        className={`relative overflow-hidden rounded-2xl p-8 ${wx.cls === "rain" || wx.cls === "storm" ? "wx-raining" : ""}`}
        style={{ background: wx.bg, minHeight: 280 }}
      >
        {/* Animação de chuva */}
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

        <div className="relative z-10">
          <div
            className="text-[11px] font-bold uppercase tracking-[0.2em]"
            style={{ color: txt2 }}
          >
            Como está o clima político
          </div>
          <div className="mt-4 flex items-center gap-6">
            <div className="text-[88px] leading-none" style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.18))" }}>
              {wx.icon}
            </div>
            <div>
              <div className="flex items-end gap-1">
                <span className="tnum text-[80px] font-extrabold leading-none" style={{ color: txt1 }}>
                  {view.iad}
                </span>
                <span className="mb-3 text-2xl font-bold" style={{ color: txt2 }}>%</span>
              </div>
              <div className="text-xl font-extrabold" style={{ color: "#EA580C" }}>
                {wx.label}
              </div>
            </div>
          </div>
          <div className="mt-4 text-base font-medium" style={{ color: txt1 }}>
            {wx.sub}
          </div>
          <div className="mt-1 text-sm" style={{ color: txt2 }}>
            Índice de Aprovação Digital · {view.posts} posts no período
          </div>
        </div>
      </div>

      {/* Volume coletado no período — DESTAQUE */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-line bg-bg-1 p-5 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">Posts analisados</div>
          <div className="tnum mt-1 text-5xl font-extrabold text-txt-1" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.25)" }}>
            {fmtInt(view.posts)}
          </div>
          <div className="mt-1 text-xs text-txt-2">publicações no período</div>
        </div>
        <div className="rounded-2xl border border-line bg-bg-1 p-5 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-txt-3">Comentários da população</div>
          <div className="tnum mt-1 text-5xl font-extrabold" style={{ color: wx.accent, textShadow: "0 2px 16px rgba(0,0,0,0.25)" }}>
            {fmtInt(view.comentarios)}
          </div>
          <div className="mt-1 text-xs text-txt-2">vozes ouvidas no período</div>
        </div>
      </div>

      {/* O que a população diz agora */}
      <div
        className="rounded-2xl border border-line bg-bg-1 p-6"
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: wx.accent }}>
          O que a população diz agora
        </div>
        <div className="mt-2 text-lg font-bold text-txt-1">
          {view.destaque}
        </div>
      </div>

      {/* Faixa de distribuição */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3 text-center">
          <div className="tnum text-2xl font-extrabold text-risk-low">{view.pctPos}%</div>
          <div className="text-xs text-txt-3">Favorável (sol)</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3 text-center">
          <div className="tnum text-2xl font-extrabold" style={{ color: "#64748B" }}>{view.pctNeu}%</div>
          <div className="text-xs text-txt-3">Neutro (nuvens)</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3 text-center">
          <div className="tnum text-2xl font-extrabold text-risk-crit">{view.pctNeg}%</div>
          <div className="text-xs text-txt-3">Desfavorável (chuva)</div>
        </div>
      </div>

      {/* Legenda da escala de clima */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 text-sm font-bold">Escala do Clima Político</div>
        <div className="grid grid-cols-2 gap-2 text-[12px] text-txt-2 sm:grid-cols-3">
          <div>☀️ <b>Céu Aberto</b> · 75-100</div>
          <div>⛅ <b>Parc. Nublado</b> · 60-74</div>
          <div>☁️ <b>Nublado</b> · 45-59</div>
          <div>🌧️ <b>Chuva</b> · 30-44</div>
          <div>⛈️ <b>Tempestade</b> · 15-29</div>
          <div>🌑 <b>Severíssimo</b> · 0-14</div>
        </div>
      </div>
    </div>
  );
}
