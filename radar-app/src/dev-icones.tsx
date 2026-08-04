// Harness de desenvolvimento dos ícones de clima animados (icones-dev.html).
// Não entra no bundle do app: é uma entrada Vite separada, usada só no dev
// server para ver as 6 condições lado a lado (fundo claro e escuro) e
// réplicas do hero da ClimaPage (mesmas classes e camadas do hero real,
// incluindo a foto de céu em fade aprovada em 04/08) sem depender de login.
import { createRoot } from "react-dom/client";
import { ClimaIconeAnimado } from "./components/ClimaIconeAnimado";
import { getWeather } from "./lib/weather";
import { limparTravessoes } from "./lib/format";
import "./index.css";

const CONDICOES = [
  { cls: "sunny", pct: 80 },
  { cls: "partly", pct: 65 },
  { cls: "cloudy", pct: 52 },
  { cls: "rain", pct: 38 },
  { cls: "storm", pct: 20 },
  { cls: "severe", pct: 8 },
];

function Fileira({ fundo, texto, rotulo }: { fundo: string; texto: string; rotulo: string }) {
  return (
    <div style={{ background: fundo, padding: "16px 24px 24px" }}>
      <div style={{ color: texto, fontWeight: 800, fontSize: 17, marginBottom: 8 }}>{rotulo}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {CONDICOES.map(({ cls, pct }) => {
          const wx = getWeather(pct);
          return (
            <div key={cls} style={{ width: 180, textAlign: "center" }}>
              <ClimaIconeAnimado cls={cls} />
              <div style={{ color: texto, fontWeight: 700, fontSize: 15, marginTop: 4 }}>
                {cls} · {wx.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Réplica do hero da ClimaPage: card claro de vidro (03/08) + foto de céu em
 * fade lateral com texto clareando sobre foto escura (04/08). */
function HeroReplica({ pct, iad }: { pct: number; iad: number }) {
  const wx = getWeather(pct);
  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-line bg-bg-1 p-7"
      style={{ minHeight: 320, maxWidth: 880, margin: "16px auto" }}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-28 h-[380px] w-[380px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(255,140,82,0.30) 0%, transparent 65%)" }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 left-0"
        style={{
          width: "58%",
          background: `${wx.heroDark ? "linear-gradient(rgba(10,12,18,0.22), rgba(10,12,18,0.22)), " : ""}url("${wx.image}") left center / cover no-repeat`,
          WebkitMaskImage: "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)",
          maskImage: "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div className="relative z-10 flex h-full flex-col">
        <div className="section-label" style={wx.heroDark ? { color: "rgba(247,244,237,0.92)" } : undefined}>
          Como a população vê a gestão
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex flex-col items-start">
            <div className="flex items-start">
              <span
                className="tnum text-[120px] leading-[0.76] tracking-tighter text-txt-1 sm:text-[168px] lg:text-[208px]"
                style={{ fontWeight: 600, fontFamily: "Space Grotesk, Inter, sans-serif", color: wx.heroDark ? "#F7F4ED" : undefined }}
              >
                {iad}
              </span>
              <span
                className="mt-3 text-5xl font-medium text-txt-2 sm:text-6xl lg:text-7xl"
                style={wx.heroDark ? { color: "rgba(247,244,237,0.85)" } : undefined}
              >
                %
              </span>
            </div>
            <p
              className="mt-6 max-w-[24ch] text-[15px] font-semibold leading-snug text-txt-2 sm:text-[17px]"
              style={wx.heroDark ? { color: "rgba(247,244,237,0.85)" } : undefined}
            >
              Aprovação da gestão nos comentários analisados no período
            </p>
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-wrap items-center justify-center gap-x-7 gap-y-3">
            <div className="w-[150px] shrink-0 sm:w-[180px] lg:w-[205px]">
              <ClimaIconeAnimado cls={wx.cls} />
            </div>
            <div
              className="min-w-0 max-w-[18ch] flex-[1_1_11rem] text-[26px] leading-tight text-txt-1 sm:text-[30px]"
              style={{ fontWeight: 600, fontFamily: "Space Grotesk, Inter, sans-serif" }}
            >
              {limparTravessoes(wx.sub)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// O app aplica o tema por classe no <html> (App.tsx); sem ela os tokens caem
// no default escuro. A réplica espelha o tema claro, que é o que o cliente usa.
document.documentElement.className = "theme-light";

// HMR: recarrega a página em vez de recriar o root (evita o warning de
// createRoot duplicado a cada edição deste arquivo).
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

const TODAS = [52, 80, 65, 38, 20, 8];

createRoot(document.getElementById("root")!).render(
  <>
    <div style={{ background: "var(--bg-page)", padding: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 17, margin: "4px 8px 0", color: "#1A2033" }}>
        Hero com foto em fade (tema claro)
      </div>
      {TODAS.map((pct) => (
        <HeroReplica key={pct} pct={pct} iad={pct} />
      ))}
    </div>
    <div className="theme-dark" style={{ background: "var(--bg-page)", padding: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 17, margin: "4px 8px 0", color: "#F1F1EE" }}>
        Hero com foto em fade (tema escuro)
      </div>
      {TODAS.map((pct) => (
        <HeroReplica key={pct} pct={pct} iad={pct} />
      ))}
    </div>

    <Fileira fundo="#F4EFE7" texto="#1A2033" rotulo="Ícones do clima: estilo aprovado em 04/08 (soft, sem contorno)" />
    <Fileira fundo="linear-gradient(105deg, #21262e, #3a4148)" texto="#FFFFFF" rotulo="Em fundo escuro" />
  </>
);
