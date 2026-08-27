import { useEffect, useState } from "react";
import { fmtInt } from "@/lib/format";

interface Props {
  label: string;
  /** Comentários negativos e positivos do tema — os neutros ficam fora do
   * ponteiro (decisão da reunião de 24/07). */
  neg: number;
  pos: number;
}

// Geometria do semicírculo — o MESMO desenho do GaugeAprovacao da Análise do
// Clima (pedido do Robério em 27/08: os medidores por tema seguem o padrão do
// medidor de aprovação). Arco de 180° com traço fino e pontas arredondadas,
// agulha de LINHA (não mais o polígono largo com sombra), cubo pequeno. O
// tacômetro de 244° com arcos decorativos internos, que veio da referência de
// 27/07, saiu — a Análise do Clima virou a referência viva.
const CX = 100;
const CY = 88;
const R = 80;            // raio da linha média do arco
const LARGURA = 11;      // espessura do traço do arco
const AGULHA = 60;       // comprimento da agulha a partir do cubo
// Arco + número embaixo; descida da fonte incluída.
const ALTURA = 142;

// A escala nos TOKENS semânticos do tema claro, os mesmos três stops do
// GaugeAprovacao (#C22626 / #E8A400 / #137A3C) — só que ESPELHADOS: lá o verde
// fica à direita porque o ponteiro mede % de APROVAÇÃO (100 = ótimo); aqui ele
// mede % de comentários NEGATIVOS, então 0% é o melhor cenário e o verde fica
// à esquerda. Um é o espelho do outro de propósito (nota de 04/08 no
// CLAUDE.md); igualar a direção junto com o desenho poria o pior resultado na
// cor boa.
const PARADAS: [number, number, number][] = [
  [0x13, 0x7a, 0x3c], // verde  (--success claro)
  [0xe8, 0xa4, 0x00], // âmbar
  [0xc2, 0x26, 0x26], // vermelho (--danger claro)
];

/** Cor da escala na posição t (0 = verde, à esquerda; 1 = vermelho). */
function corEscala(t: number): string {
  const s = Math.min(1, Math.max(0, t)) * 2;
  const i = s < 1 ? 0 : 1;
  const f = s - i;
  const a = PARADAS[i];
  const b = PARADAS[i + 1];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Ângulo da agulha para um valor 0-100: -90° aponta a ponta esquerda. */
function anguloDoValor(v: number): number {
  return (Math.min(100, Math.max(0, v)) / 100) * 180 - 90;
}

/**
 * Velocímetro por tema no padrão do GaugeAprovacao (27/08). O ponteiro aponta
 * a % real de comentários NEGATIVOS entre os que tomam partido (revisão de
 * 25/07) e **vibra o tempo todo**, como agulha de instrumento vivo. A vibração
 * é animação CSS de `transform` — roda no compositor e continua durante a
 * rolagem. Continua SVG puro: a ClimaPage é a landing e o chunk do ECharts é
 * de ~1 MB.
 */
export function GaugeTema({ label, neg, pos }: Props) {
  const total = neg + pos;
  const valor = total > 0 ? Math.round((neg / total) * 100) : 0;
  const critico = total >= 5 && valor >= 70;
  const corValor = corEscala(valor / 100);

  // O ponteiro entra varrendo de 0% até o valor: o primeiro quadro sai no zero
  // e o valor real é aplicado logo depois do commit, dando à transição de CSS
  // de onde sair. O agendamento é `useEffect`, e não `requestAnimationFrame`:
  // rAF não roda em página oculta (aba em segundo plano, janela minimizada),
  // e nessa situação a agulha ficava travada no zero até alguém olhar para
  // ela — apontando um valor errado justamente no painel que fica aberto o dia
  // inteiro numa TV.
  const [alvo, setAlvo] = useState(0);
  useEffect(() => setAlvo(valor), [valor]);

  const eixo = { transformBox: "view-box", transformOrigin: `${CX}px ${CY}px` } as const;

  return (
    <div
      className="rounded-2xl border bg-bg-1 px-2 pb-3 pt-2 text-center"
      style={
        critico
          ? { borderColor: "rgba(239,68,68,0.55)", animation: "gauge-alerta 1.6s ease-in-out infinite" }
          : { borderColor: "var(--line)" }
      }
    >
      <style>{`
        @keyframes gauge-alerta {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          50% { box-shadow: 0 0 18px -2px rgba(239,68,68,0.55); }
        }
        /* Vibração perpétua da agulha — a mesma amplitude do GaugeAprovacao. */
        @keyframes gauge-agulha-vibra {
          0%, 100% { transform: rotate(-0.7deg); }
          50% { transform: rotate(0.7deg); }
        }
        .gauge-agulha-vibra {
          animation: gauge-agulha-vibra 1.1s ease-in-out infinite;
        }
        .gauge-agulha-alvo {
          transition: transform 1100ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .gauge-agulha-vibra { animation: none; }
          .gauge-agulha-alvo { transition: none; }
          [style*="gauge-alerta"] { animation: none !important; }
        }
      `}</style>
      <div className="truncate px-1 text-[14px] font-bold text-txt-1" title={label}>
        {label}
      </div>

      {/* text-txt-1: a agulha e o cubo são `currentColor`, como no
          GaugeAprovacao — a tinta do instrumento é a tinta do texto do tema. */}
      <svg
        viewBox={`0 0 200 ${ALTURA}`}
        className="mx-auto mt-1 block w-full max-w-[210px] text-txt-1"
        role="img"
        aria-label={`${label}: ${valor}% de comentários negativos`}
      >
        <defs>
          {/* Degradê horizontal com os três stops do GaugeAprovacao,
              espelhados (ver PARADAS). O id é fixo mesmo havendo um gauge por
              tema na página: id repetido resolve para a PRIMEIRA definição do
              documento, e como todas são idênticas o resultado é o mesmo — o
              useId que existia aqui era necessidade do degradê antigo, que
              variava por instância (userSpaceOnUse ancorado no arco). */}
          <linearGradient id="gtema" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#137A3C" />
            <stop offset="50%" stopColor="#E8A400" />
            <stop offset="100%" stopColor="#C22626" />
          </linearGradient>
        </defs>

        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="url(#gtema)"
          strokeWidth={LARGURA}
          strokeLinecap="round"
        />

        {/* Agulha: o grupo de fora aponta o valor, o de dentro vibra. */}
        <g
          className="gauge-agulha-alvo"
          style={{ ...eixo, transform: `rotate(${anguloDoValor(alvo)}deg)` }}
        >
          <g className="gauge-agulha-vibra" style={eixo}>
            <line
              x1={CX}
              y1={CY}
              x2={CX}
              y2={CY - AGULHA}
              stroke="currentColor"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
          </g>
        </g>
        <circle cx={CX} cy={CY} r="7" fill="currentColor" />

        {/* Valor abaixo do arco, na cor da posição da escala. */}
        <text
          x={CX}
          y={CY + 42}
          textAnchor="middle"
          fill={corValor}
          style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 27, fontWeight: 800, letterSpacing: "0.02em" }}
        >
          {valor}%
        </text>
      </svg>

      {/* O peso vai inline, e sem classe de peso junto: a diretriz global do
          index.css rebaixa font-semibold/font-bold para 400 com !important, e
          a classe venceria o estilo inline. Era por isso que este contador
          aparecia em peso regular apesar do `font-semibold`. */}
      <div className="mt-0.5 flex items-center justify-center gap-4 text-[17px]">
        <span className="tnum" style={{ color: "#EF4444", fontWeight: 800 }}>{fmtInt(neg)} neg</span>
        <span className="tnum" style={{ color: "#22C55E", fontWeight: 800 }}>{fmtInt(pos)} pos</span>
      </div>
    </div>
  );
}
