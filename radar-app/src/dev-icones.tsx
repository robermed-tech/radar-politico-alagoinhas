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

// Mesmo perfil de fade da ClimaPage (04/08, 7a rodada: mais desvanecencia).
const PARADAS_FADE =
  "rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.88) 16%, rgba(0,0,0,0.58) 34%, " +
  "rgba(0,0,0,0.30) 54%, rgba(0,0,0,0.11) 72%, rgba(0,0,0,0) 88%";
const FADE_LATERAL = `linear-gradient(to left, ${PARADAS_FADE})`;
const FADE_RODAPE = `linear-gradient(to top, ${PARADAS_FADE})`;

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
 * fade lateral (04/08, 2ª rodada: fade mais curto, título do clima em
 * destaque, tinta fixa pela luminância da foto). `temaEscuro` substitui o
 * useThemeStore da página real: aqui as duas seções convivem na mesma tela. */
function HeroReplica({ pct, iad, temaEscuro = false }: { pct: number; iad: number; temaEscuro?: boolean }) {
  const wx = getWeather(pct);
  // Espelha a regra da ClimaPage (04/08): tema claro = tinta preta em toda
  // foto e véu que CLAREIA; tema escuro = tinta clara e véu que escurece.
  const inkFoto = !temaEscuro
    ? { forte: "#0B0E14", suave: "#0B0E14", rotulo: "#0B0E14" }
    : wx.heroDark
      ? { forte: "#F7F4ED", suave: "rgba(247,244,237,0.85)", rotulo: "rgba(247,244,237,0.92)" }
      : null;
  const veuFoto = !temaEscuro
    ? "linear-gradient(rgba(255,255,255,0.42), rgba(255,255,255,0.42)), "
    : wx.heroDark
      ? "linear-gradient(rgba(10,12,18,0.50), rgba(10,12,18,0.50)), "
      : "";
  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-line bg-bg-1 p-7"
      style={{ minHeight: 320, maxWidth: 880, margin: "16px auto" }}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-28 h-[380px] w-[380px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(249,168,90,0.30) 0%, transparent 65%)" }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden sm:block"
        style={{
          width: "52%",
          background: `${veuFoto}url("${wx.image}") right center / cover no-repeat`,
          WebkitMaskImage:
            FADE_LATERAL,
          maskImage:
            FADE_LATERAL,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 sm:hidden"
        style={{
          height: "62%",
          background: `${veuFoto}url("${wx.image}") center bottom / cover no-repeat`,
          WebkitMaskImage:
            FADE_RODAPE,
          maskImage:
            FADE_RODAPE,
        }}
      />
      <div className="relative z-10 flex h-full flex-col">
        <div className="section-label">
          Como a população vê a gestão
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex flex-col items-start">
            <div className="flex items-start">
              <span
                className="text-[120px] leading-[0.76] text-txt-1 sm:text-[168px] lg:text-[208px]"
                style={{ fontWeight: 600, fontFamily: "Space Grotesk, Inter, sans-serif" }}
              >
                {iad}
              </span>
              <span className="mt-3 text-5xl font-medium text-txt-2 sm:text-6xl lg:text-7xl">%</span>
            </div>
            <p className="mt-6 max-w-[24ch] text-[15px] font-semibold leading-snug text-txt-2 sm:text-[17px]">
              Aprovação da gestão nos comentários analisados no período
            </p>
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-wrap items-center justify-center gap-x-7 gap-y-3">
            <div className="w-[150px] shrink-0 sm:w-[180px] lg:w-[104px]">
              <ClimaIconeAnimado cls={wx.cls} />
            </div>
            <div className="min-w-0 flex-[1_1_16rem]" style={{ containerType: "inline-size" }}>
              <div
                className="text-[30px] font-extrabold uppercase leading-none tracking-tight text-txt-1 break-words sm:text-[clamp(30px,11.5cqi,36px)]"
                style={{ fontFamily: "Space Grotesk, Inter, sans-serif", color: inkFoto?.forte }}
              >
                {wx.label}
              </div>
              <div
                className="mt-2 text-[18px] leading-snug text-txt-2 sm:text-[20px]"
                style={{ fontWeight: 600, fontFamily: "Space Grotesk, Inter, sans-serif", color: inkFoto?.suave }}
              >
                {limparTravessoes(wx.sub)}
              </div>
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
        <HeroReplica key={pct} pct={pct} iad={pct} temaEscuro />
      ))}
    </div>

    <Fileira fundo="#F4EFE7" texto="#1A2033" rotulo="Ícones do clima: estilo aprovado em 04/08 (soft, sem contorno)" />
    <Fileira fundo="linear-gradient(105deg, #21262e, #3a4148)" texto="#FFFFFF" rotulo="Em fundo escuro" />
  </>
);
