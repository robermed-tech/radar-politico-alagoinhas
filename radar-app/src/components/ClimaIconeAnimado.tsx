/**
 * Ícone de clima ANIMADO do hero da Estação Meteorológica (revisão de 04/08):
 * um desenho por condição do getWeather, em movimento contínuo.
 *
 * O estilo aprovado pelo cliente (04/08, escolhido entre duas prévias no
 * harness icones-dev.html) é o SOFT, SEM CONTORNO: só preenchimentos em
 * degradê. A primeira versão, com linha azul-marinho fiel ao vídeo de
 * referência, foi preterida e removida — não recriar sem pedido. Sem o traço
 * dando definição, as formas compensam com gradientes mais contrastados,
 * SOMBRA DE BASE nas nuvens (a silhueta repetida um degrau abaixo) e um
 * brilho radial atrás do sol — sem isso, nuvem branca some em fundo claro.
 *
 * SVG puro + animação CSS de transform/opacity, que roda no compositor e
 * sobrevive à rolagem e à aba oculta — mesma regra do GaugeTema e da
 * AntenaSinal: nunca requestAnimationFrame, nunca ECharts (a ClimaPage é a
 * landing). Com prefers-reduced-motion o desenho fica PARADO E COMPLETO
 * (gotas, raios e vento visíveis pela opacidade de atributo), nunca vazio.
 *
 * Grupos animados nunca carregam atributo `transform` próprio: a animação CSS
 * de transform SUBSTITUI o atributo, então posicionamento fica num <g>
 * externo e a classe de animação num <g> interno.
 */

// Nuvem base (mesma silhueta do WeatherIcon de linha, escalada p/ viewBox 120)
const NUVEM = "M35 90h46a20 20 0 0 0 1.5-40A27.5 27.5 0 0 0 30 58A19 19 0 0 0 35 90z";
// Fio de luz no lóbulo esquerdo (sombreado flat)
const BRILHO_NUVEM = "M32 60a25 25 0 0 1 27-15";
// Relâmpago (usado na tempestade e no severíssimo)
const RAIO = "M58 60 L46 84h10L50 106 76 78H64l8-18z";

// Degradês (topo mais claro, base mais funda: é o contraste interno que
// sustenta a forma sem contorno).
const GRAD: Record<string, [string, string]> = {
  sol: ["#FFEA9E", "#F6A63A"],
  "nuvem-clara": ["#FFFFFF", "#C6D4EE"],
  "nuvem-azul": ["#DCE8FC", "#7E9FDE"],
  "nuvem-lavanda": ["#DCDFFC", "#8A93E0"],
  "nuvem-escura": ["#8E98BE", "#3F486E"],
  raio: ["#FFDD66", "#F59E0B"],
};

// Sombra de base e fio de luz de cada nuvem (a sombra dá o "assento" que o
// contorno dava).
const NUVENS: Record<string, { sombra: string; brilho: string }> = {
  "nuvem-clara": { sombra: "#9FB2D8", brilho: "#FFFFFF" },
  "nuvem-azul": { sombra: "#5F7FC4", brilho: "#FFFFFF" },
  "nuvem-lavanda": { sombra: "#6B74C8", brilho: "#FFFFFF" },
  "nuvem-escura": { sombra: "#20284A", brilho: "#B9C2E8" },
};

function Faisca({ x, y, delay, escala = 1 }: { x: number; y: number; delay: string; escala?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${escala})`}>
      <path
        className="wxa-faisca"
        style={{ animationDelay: delay, transformBox: "fill-box", transformOrigin: "center" }}
        d="M0 -5.5 L1.4 -1.4 L5.5 0 L1.4 1.4 L0 5.5 L-1.4 1.4 L-5.5 0 L-1.4 -1.4 Z"
        fill="#FFC93F"
        opacity="0.85"
      />
    </g>
  );
}

function Gota({ x, y, delay, dur, angulo = 14, comprimento = 11, cor = "#63A0F2" }: {
  x: number; y: number; delay: string; dur: string; angulo?: number; comprimento?: number; cor?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angulo})`}>
      <line
        className="wxa-gota"
        style={{ animationDelay: delay, animationDuration: dur }}
        x1="0" y1="0" x2="0" y2={comprimento}
        stroke={cor} strokeWidth="4.5" strokeLinecap="round" opacity="0.9"
      />
    </g>
  );
}

/** Traços de sol ao redor do disco, num grupo que gira devagar. */
function RaiosDeSol({ cx, cy, r, cor }: { cx: number; cy: number; r: number; cor: string }) {
  return (
    <g className="wxa-gira" style={{ transformBox: "view-box", transformOrigin: `${cx}px ${cy}px` }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <line
          key={i}
          x1={cx} y1={cy - r - 14} x2={cx} y2={cy - r - 5}
          transform={`rotate(${i * 45} ${cx} ${cy})`}
          stroke={cor} strokeWidth="4.5" strokeLinecap="round"
        />
      ))}
    </g>
  );
}

function Sol({ cx, cy, r, raios = "#F1A03C" }: { cx: number; cy: number; r: number; raios?: string }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r * 1.7} fill="url(#wxa-glow)" />
      <RaiosDeSol cx={cx} cy={cy} r={r} cor={raios} />
      <g className="wxa-respira" style={{ transformBox: "view-box", transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={r} fill="url(#wxa-sol)" />
      </g>
    </>
  );
}

function Nuvem({ tipo }: { tipo: keyof typeof NUVENS }) {
  const n = NUVENS[tipo];
  return (
    <>
      <path d={NUVEM} transform="translate(0 3.5)" fill={n.sombra} opacity="0.45" />
      <path d={NUVEM} fill={`url(#wxa-${tipo})`} />
      <path d={BRILHO_NUVEM} fill="none" stroke={n.brilho} strokeWidth="4.5" strokeLinecap="round" opacity="0.55" />
    </>
  );
}

function Relampago() {
  return <path d={RAIO} fill="url(#wxa-raio)" />;
}

function Vento({ d, delay }: { d: string; delay: string }) {
  return (
    <path
      className="wxa-vento"
      style={{ animationDelay: delay }}
      d={d}
      fill="none" stroke="#86A5DE" strokeWidth="4" strokeLinecap="round" opacity="0.55"
    />
  );
}

function desenho(cls: string) {
  switch (cls) {
    case "sunny":
      return (
        <>
          <Sol cx={60} cy={62} r={24} />
          <Faisca x={97} y={34} delay="0s" />
          <Faisca x={23} y={46} delay="-0.9s" escala={0.7} />
          <Faisca x={93} y={91} delay="-1.7s" escala={0.55} />
        </>
      );

    case "partly":
      return (
        <>
          <Sol cx={60} cy={40} r={16} />
          <Faisca x={101} y={26} delay="-0.5s" escala={0.7} />
          {/* nuvem satélite, atrás, em contra-fase */}
          <g transform="translate(70 62) scale(0.38)">
            <g className="wxa-flutua" style={{ animationDelay: "-2.3s" }}>
              <Nuvem tipo="nuvem-azul" />
            </g>
          </g>
          {/* nuvem principal, na frente do sol */}
          <g transform="translate(4 30) scale(0.82)">
            <g className="wxa-flutua">
              <Nuvem tipo="nuvem-clara" />
            </g>
          </g>
        </>
      );

    case "cloudy":
      return (
        <>
          {/* nuvem distante, quase parada */}
          <g transform="translate(8 18) scale(0.34)" opacity="0.6">
            <g className="wxa-flutua" style={{ animationDelay: "-1.2s", animationDuration: "7s" }}>
              <Nuvem tipo="nuvem-azul" />
            </g>
          </g>
          <g transform="translate(56 32) scale(0.52)">
            <g className="wxa-flutua" style={{ animationDelay: "-2.6s" }}>
              <Nuvem tipo="nuvem-azul" />
            </g>
          </g>
          <g transform="translate(0 8) scale(0.92)">
            <g className="wxa-flutua">
              <Nuvem tipo="nuvem-clara" />
            </g>
          </g>
        </>
      );

    case "rain":
      return (
        <>
          <g transform="translate(6 -8) scale(0.92)">
            <g className="wxa-flutua">
              <Nuvem tipo="nuvem-azul" />
            </g>
          </g>
          <Gota x={38} y={84} delay="0s" dur="1.2s" />
          <Gota x={54} y={84} delay="-0.3s" dur="1.2s" />
          <Gota x={70} y={84} delay="-0.6s" dur="1.2s" />
          <Gota x={86} y={84} delay="-0.9s" dur="1.2s" />
        </>
      );

    case "storm":
      return (
        <>
          <g className="wxa-raio">
            <Relampago />
          </g>
          <g transform="translate(8 -10) scale(0.9)">
            <g className="wxa-flutua">
              <Nuvem tipo="nuvem-lavanda" />
            </g>
          </g>
          <Vento d="M10 86h20a5.5 5.5 0 1 0 -5.5 -8" delay="0s" />
          <Vento d="M18 98h24a5 5 0 1 1 -4 8" delay="-1.4s" />
        </>
      );

    default: // severe
      return (
        <>
          {/* clarão de relâmpago atrás da nuvem, aceso junto com o raio */}
          <ellipse className="wxa-clarao" cx="60" cy="50" rx="46" ry="30" fill="url(#wxa-clarao)" opacity="0.3" />
          <g transform="translate(4 -12) scale(0.95)">
            <g className="wxa-flutua" style={{ animationDuration: "3.4s" }}>
              <Nuvem tipo="nuvem-escura" />
            </g>
          </g>
          {/* UM raio, maior, pela FRENTE da nuvem, sem eco nem contorno —
              forma aprovada em 04/08 (a versão de 2 raios atrás da nuvem foi
              rejeitada na prévia). O amarelo em degradê se separa sozinho do
              corpo escuro da nuvem. */}
          <g className="wxa-raio">
            <g transform="translate(-8 -14) scale(1.15)">
              <Relampago />
            </g>
          </g>
          <Gota x={26} y={80} delay="0s" dur="0.9s" angulo={20} comprimento={12} cor="#7FA8F0" />
          <Gota x={94} y={78} delay="-0.45s" dur="0.9s" angulo={20} comprimento={10} cor="#7FA8F0" />
        </>
      );
  }
}

export function ClimaIconeAnimado({ cls, className }: { cls: string; className?: string }) {
  return (
    <div className={className}>
      <style>{`
        @keyframes wxa-gira { to { transform: rotate(360deg); } }
        @keyframes wxa-respira { from { transform: scale(1); } to { transform: scale(1.05); } }
        @keyframes wxa-flutua {
          from { transform: translate3d(-3.5px, 0, 0); }
          to   { transform: translate3d(3.5px, 0, 0); }
        }
        @keyframes wxa-gota {
          0%   { transform: translate3d(0, -5px, 0); opacity: 0; }
          25%  { opacity: 0.9; }
          75%  { opacity: 0.9; }
          100% { transform: translate3d(-4px, 15px, 0); opacity: 0; }
        }
        /* O raio fica visível quase o ciclo todo e "pisca" duas vezes: o
           estado de repouso (reduced motion) é o desenho completo. */
        @keyframes wxa-raio {
          0%, 38%, 48%, 56%, 100% { opacity: 1; }
          43%, 52% { opacity: 0.15; }
        }
        @keyframes wxa-clarao {
          0%, 36%, 60%, 100% { opacity: 0; }
          44%, 52% { opacity: 0.55; }
        }
        @keyframes wxa-vento {
          0%   { transform: translate3d(-12px, 0, 0); opacity: 0; }
          30%  { opacity: 0.75; }
          70%  { opacity: 0.75; }
          100% { transform: translate3d(18px, 0, 0); opacity: 0; }
        }
        @keyframes wxa-faisca {
          0%, 100% { opacity: 0.25; transform: scale(0.65); }
          50%      { opacity: 1; transform: scale(1.1); }
        }
        .wxa-gira    { animation: wxa-gira 32s linear infinite; will-change: transform; }
        .wxa-respira { animation: wxa-respira 4.2s ease-in-out infinite alternate; }
        .wxa-flutua  { animation: wxa-flutua 4.6s ease-in-out infinite alternate; will-change: transform; }
        .wxa-gota    { animation: wxa-gota 1.2s linear infinite; will-change: transform, opacity; }
        .wxa-raio    { animation: wxa-raio 3.4s linear infinite; }
        .wxa-clarao  { animation: wxa-clarao 3.4s linear infinite; }
        .wxa-vento   { animation: wxa-vento 2.8s ease-in-out infinite; will-change: transform, opacity; }
        .wxa-faisca  { animation: wxa-faisca 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .wxa-gira, .wxa-respira, .wxa-flutua, .wxa-gota,
          .wxa-raio, .wxa-clarao, .wxa-vento, .wxa-faisca { animation: none !important; }
        }
      `}</style>
      <svg viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <radialGradient id="wxa-sol" cx="42%" cy="38%" r="72%">
            <stop offset="0%" stopColor={GRAD.sol[0]} />
            <stop offset="100%" stopColor={GRAD.sol[1]} />
          </radialGradient>
          {(["nuvem-clara", "nuvem-azul", "nuvem-lavanda", "nuvem-escura"] as const).map((t) => (
            <linearGradient key={t} id={`wxa-${t}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GRAD[t][0]} />
              <stop offset="100%" stopColor={GRAD[t][1]} />
            </linearGradient>
          ))}
          <linearGradient id="wxa-raio" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GRAD.raio[0]} />
            <stop offset="100%" stopColor={GRAD.raio[1]} />
          </linearGradient>
          {/* brilho atrás do sol: dá a definição que o contorno dava */}
          <radialGradient id="wxa-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD76B" stopOpacity="0.55" />
            <stop offset="70%" stopColor="#FFD76B" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#FFD76B" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wxa-clarao" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFE9A8" />
            <stop offset="100%" stopColor="#FFE9A8" stopOpacity="0" />
          </radialGradient>
          {/* assento translúcido: dá leitura ao desenho quando o card do hero
              resolve escuro (tema dark), sem pesar no tema claro */}
          <radialGradient id="wxa-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="62" rx="56" ry="48" fill="url(#wxa-halo)" opacity="0.16" />
        {desenho(cls)}
      </svg>
    </div>
  );
}
