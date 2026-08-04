import { useEffect, useId, useState } from "react";
import { useThemeStore } from "@/stores/theme";
import { chartInk } from "@/lib/chartTheme";
import { fmtInt } from "@/lib/format";

interface Props {
  label: string;
  /** Comentários negativos e positivos do tema — os neutros ficam fora do
   * ponteiro (decisão da reunião de 24/07). */
  neg: number;
  pos: number;
}

// Geometria do arco. O vão fica embaixo, como no tacômetro de referência.
//
// As pontas do arco descem abaixo do centro (o arco varre 244°, mais que meia
// volta), então a caixa precisa de altura para elas E para o valor embaixo:
// com CY=90, a ponta fica em 90 + 68·sen(32°) + metade do traço ≈ 133, e o
// número vive a partir daí. Encolher a viewBox recorta as pontas.
const CX = 100;
const CY = 90;
const R = 68;            // raio da linha média do arco grosso
const LARGURA = 14;      // espessura do arco
const ANG_INI = 212;     // 0% — ponta esquerda
const ANG_FIM = -32;     // 100% — ponta direita
// Altura da viewBox: pontas do arco + número, com folga para a caixa de texto
// do número (a fonte reserva descida abaixo da linha de base). Encolheu de 174
// para 166 quando o traço decorativo saiu de cima do valor.
const ALTURA = 166;

/**
 * Cor da escala na posição t (0 = verde, à esquerda; 1 = vermelho, à direita).
 *
 * O modelo de referência trazido pelo cliente é vermelho à esquerda e verde à
 * direita, porque mede um score em que "alto é bom". Aqui o ponteiro mede a %
 * de comentários NEGATIVOS: 0% é o melhor cenário possível. Inverter o degradê
 * junto com o desenho colocaria o melhor resultado no vermelho. O que foi
 * adotado da referência é a FORMA (arco contínuo em degradê, pontas
 * arredondadas, arcos internos, ponteiro longo com cubo); o significado das
 * cores segue o do produto.
 */
function corEscala(t: number): string {
  return `hsl(${Math.round(130 - t * 130)}, 78%, 46%)`;
}

/** Ponto na circunferência para um ângulo em graus (0° = leste, anti-horário). */
function ponto(ang: number, raio: number): [number, number] {
  const rad = (ang * Math.PI) / 180;
  return [CX + raio * Math.cos(rad), CY - raio * Math.sin(rad)];
}

/** Caminho do arco de ANG_INI até `ate`, no sentido horário. */
function arco(ate: number, raio: number): string {
  const [x1, y1] = ponto(ANG_INI, raio);
  const [x2, y2] = ponto(ate, raio);
  const grande = ANG_INI - ate > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${raio} ${raio} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Ângulo do ponteiro para um valor de 0 a 100. */
function anguloDoValor(v: number): number {
  const t = Math.min(100, Math.max(0, v)) / 100;
  return ANG_INI - t * (ANG_INI - ANG_FIM);
}

/**
 * Velocímetro por tema, no modelo pedido pelo cliente: arco único em degradê
 * contínuo com pontas arredondadas, dois arcos finos decorativos por dentro e
 * um ponteiro longo saindo de um cubo circular.
 *
 * O ponteiro aponta a % real de comentários NEGATIVOS entre os que tomam
 * partido (revisão de 25/07) e **vibra o tempo todo** em torno desse valor,
 * como agulha de instrumento vivo. A vibração é uma animação CSS de
 * `transform` — roda no compositor, então continua durante a rolagem da
 * página, que é justamente o que foi pedido. Antes este componente era um
 * gauge do ECharts, que anima uma vez e para; e puxava ~1 MB de chunk para
 * desenhar um arco e uma agulha.
 */
export function GaugeTema({ label, neg, pos }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const ink = chartInk(theme);
  const gradId = useId().replace(/:/g, "");
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
        /* Vibração perpétua da agulha, em torno do ângulo do valor. */
        @keyframes gauge-agulha-vibra {
          0%   { transform: rotate(-1.6deg); }
          18%  { transform: rotate(1.1deg); }
          37%  { transform: rotate(-0.9deg); }
          55%  { transform: rotate(1.6deg); }
          74%  { transform: rotate(-1.2deg); }
          100% { transform: rotate(0.7deg); }
        }
        .gauge-agulha-vibra {
          animation: gauge-agulha-vibra 1.15s ease-in-out infinite alternate;
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

      <svg
        viewBox={`0 0 200 ${ALTURA}`}
        className="mx-auto mt-1 block w-full max-w-[210px]"
        role="img"
        aria-label={`${label}: ${valor}% de comentários negativos`}
      >
        <defs>
          {/* Degradê horizontal: aproxima o degradê ao longo do arco com uma
              interpolação só, do mesmo jeito que a referência. */}
          <linearGradient id={`g-${gradId}`} x1={CX - R} y1="0" x2={CX + R} y2="0" gradientUnits="userSpaceOnUse">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <stop key={t} offset={t} stopColor={corEscala(t)} />
            ))}
          </linearGradient>
          <filter id={`s-${gradId}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" floodColor="#000" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Arco principal */}
        <path
          d={arco(ANG_FIM, R)}
          fill="none"
          stroke={`url(#g-${gradId})`}
          strokeWidth={LARGURA}
          strokeLinecap="round"
        />
        {/* Arcos finos internos — detalhe do modelo de referência */}
        <path d={arco(ANG_FIM + 16, R - 17)} fill="none" stroke={ink.track} strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
        <path d={arco(ANG_FIM + 26, R - 24)} fill="none" stroke={ink.track} strokeWidth="2.4" strokeLinecap="round" opacity="0.65" />

        {/* Ponteiro: o grupo de fora aponta o valor, o de dentro vibra sem parar */}
        <g
          className="gauge-agulha-alvo"
          style={{ ...eixo, transform: `rotate(${-anguloDoValor(alvo)}deg)` }}
        >
          <g className="gauge-agulha-vibra" style={eixo}>
            <path
              d={`M ${CX} ${CY - 5.4} Q ${CX + 34} ${CY - 2.2} ${CX + R - 4} ${CY - 0.9} L ${CX + R - 4} ${CY + 0.9} Q ${CX + 34} ${CY + 2.2} ${CX} ${CY + 5.4} Z`}
              fill={ink.detail}
              filter={`url(#s-${gradId})`}
            />
          </g>
        </g>
        <circle cx={CX} cy={CY} r="9.5" fill={ink.detail} filter={`url(#s-${gradId})`} />
        <circle cx={CX} cy={CY} r="3.4" fill="var(--g1)" opacity="0.35" />

        {/* Valor abaixo das pontas do arco. O traço horizontal que existia
            acima dele saiu na revisão de 27/07: era enfeite herdado da imagem
            de referência e, nos cards estreitos, virava um risco solto que
            parecia parte da escala. */}
        <text
          x={CX}
          y={CY + 66}
          textAnchor="middle"
          fill={corValor}
          style={{ fontFamily: "Space Grotesk, Inter, sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: "0.02em" }}
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
