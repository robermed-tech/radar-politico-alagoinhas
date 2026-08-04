/**
 * Céu animado do hero da Estação Meteorológica (prévia aprovada em 03/08).
 *
 * Substitui a foto de céu com véu escuro: o hero virou card claro de vidro, e
 * o clima passou a ser desenhado em CSS — sol em degradê da marca, nuvens,
 * gotas e raio — na mesma linguagem do protótipo (o "sol que flutua" com a
 * nuvem à deriva). Uma cena por condição (`wx.cls`), do céu aberto ao
 * severíssimo.
 *
 * Toda animação é CSS de transform/opacity (compositor; sobrevive à rolagem e
 * à aba oculta — a regra do velocímetro). O flutuar do sol reusa o
 * `wx-flutuar` global; o resto é local porque só esta cena consome.
 * As cores das nuvens vêm de tokens (`--ceu-*`, index.css) para a cena
 * funcionar nos dois temas sem reimplementar cor aqui.
 */

const GOTAS = [
  { left: 28, delay: 0 },
  { left: 48, delay: 0.45 },
  { left: 68, delay: 0.9 },
];

function Sol({ x = 14, y = 14, tam = 74 }: { x?: number; y?: number; tam?: number }) {
  return (
    <div
      className="wx-flutuar absolute rounded-full"
      style={{
        left: x,
        top: y,
        width: tam,
        height: tam,
        background: "radial-gradient(circle at 35% 30%, #FF8C52, #E0501A)",
        boxShadow: "0 0 44px 12px rgba(255,140,82,0.45)",
      }}
    />
  );
}

function Nuvem({
  x,
  y,
  escura = false,
  atras = false,
  duracao = 7,
}: {
  x: number;
  y: number;
  escura?: boolean;
  atras?: boolean;
  duracao?: number;
}) {
  return (
    <div
      className="ceu-deriva absolute"
      style={{
        left: x,
        top: y,
        width: 62,
        height: 22,
        borderRadius: 40,
        background: escura ? "var(--ceu-nuvem-escura)" : "var(--ceu-nuvem)",
        boxShadow: escura
          ? "20px -12px 0 -4px var(--ceu-nuvem-escura), -18px 4px 0 -6px var(--ceu-nuvem-2)"
          : "20px -12px 0 -4px var(--ceu-nuvem), -18px 4px 0 -6px var(--ceu-nuvem-2)",
        // O contorno da nuvem é o drop-shadow, não a cor da massa: o filtro
        // acompanha a silhueta inteira (inclusive os pufes em box-shadow) e é
        // o que separa a nuvem clara do card claro — correção de 04/08, a
        // nuvem branca media 1,04:1 e sumia (print do cliente).
        filter:
          "drop-shadow(0 0 1px var(--ceu-nuvem-halo)) drop-shadow(0 3px 6px var(--ceu-nuvem-halo))",
        opacity: atras ? 0.55 : 0.96,
        animationDuration: `${duracao}s`,
        zIndex: atras ? 0 : 1,
      }}
    />
  );
}

function Gotas({ rapidas = false }: { rapidas?: boolean }) {
  return (
    <>
      {GOTAS.map((g) => (
        <span
          key={g.left}
          className="ceu-gota absolute"
          style={{
            left: `${g.left}%`,
            top: 74,
            animationDelay: `${g.delay}s`,
            animationDuration: rapidas ? "0.7s" : "1.1s",
          }}
        />
      ))}
    </>
  );
}

function Raio({ x = 52, delay = 0 }: { x?: number; delay?: number }) {
  return (
    <svg
      className="ceu-raio absolute"
      style={{ left: x, top: 66, animationDelay: `${delay}s` }}
      width="18"
      height="30"
      viewBox="0 0 18 30"
      fill="none"
      aria-hidden
    >
      <path d="M10 0 3 14h6l-4 16L16 11H9l4-11z" fill="#FFB067" />
    </svg>
  );
}

export function CeuAnimado({ cls }: { cls: string }) {
  return (
    <div className="relative shrink-0" style={{ width: 122, height: 112 }} aria-hidden>
      <style>{`
        @keyframes ceu-deriva { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(13px); } }
        .ceu-deriva { animation: ceu-deriva 7s ease-in-out infinite; will-change: transform; }
        @keyframes ceu-gota {
          0%   { transform: translateY(0);    opacity: 0; }
          25%  { opacity: 0.8; }
          100% { transform: translateY(30px); opacity: 0; }
        }
        .ceu-gota {
          width: 2px; height: 10px; border-radius: 1px;
          background: linear-gradient(transparent, var(--ceu-gota));
          animation: ceu-gota 1.1s linear infinite; will-change: transform, opacity;
        }
        @keyframes ceu-raio {
          0%, 86%, 100% { opacity: 0; }
          88%, 94% { opacity: 1; }
        }
        .ceu-raio { animation: ceu-raio 3.2s linear infinite; will-change: opacity; }
        @media (prefers-reduced-motion: reduce) {
          .ceu-deriva, .ceu-gota, .ceu-raio { animation: none; }
          .ceu-gota { opacity: 0.4; }
          .ceu-raio { opacity: 0.8; }
        }
      `}</style>

      {cls === "sunny" && <Sol x={24} y={16} tam={78} />}

      {cls === "partly" && (
        <>
          <Sol />
          <Nuvem x={52} y={52} />
        </>
      )}

      {cls === "cloudy" && (
        <>
          <Nuvem x={44} y={24} atras duracao={9} />
          <Nuvem x={18} y={50} />
        </>
      )}

      {cls === "rain" && (
        <>
          <Nuvem x={26} y={34} />
          <Gotas />
        </>
      )}

      {cls === "storm" && (
        <>
          <Nuvem x={26} y={30} escura />
          <Raio x={50} />
          <Gotas />
        </>
      )}

      {cls === "severe" && (
        <>
          <Nuvem x={38} y={22} escura atras duracao={9} />
          <Nuvem x={16} y={40} escura />
          <Raio x={36} />
          <Raio x={66} delay={1.4} />
          <Gotas rapidas />
        </>
      )}
    </div>
  );
}
