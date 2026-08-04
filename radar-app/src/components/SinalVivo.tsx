/**
 * Sinais de vida da Rádio Escuta (onda 2 do redesign, 03/08): o LED que pulsa
 * e o equalizador de barras do protótipo aprovado. Componente único com dois
 * primitivos porque os dois aparecem juntos e usam os mesmos keyframes
 * compartilhados do index.css (`led-pulso`, `eq-barra`) — animação CSS de
 * transform/opacity, nunca requestAnimationFrame (a regra do velocímetro:
 * rAF para em aba oculta).
 */

/**
 * Ponto de estado com halo pulsante quando ligado. O ponto é o dado
 * (ligado/desligado) e fica sempre visível; o halo é só vida, e some em
 * `prefers-reduced-motion` (regra no index.css).
 */
export function LedVivo({
  ligado,
  cor = "var(--brand)",
  corDesligado = "#94A3B8",
  size = 8,
}: {
  ligado: boolean;
  cor?: string;
  corDesligado?: string;
  size?: number;
}) {
  const c = ligado ? cor : corDesligado;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden>
      {ligado && (
        <span
          className="led-pulso absolute inset-0 rounded-full"
          style={{ border: `1.5px solid ${c}` }}
        />
      )}
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: c, boxShadow: ligado ? `0 0 ${size}px ${c}` : undefined }}
      />
    </span>
  );
}

/* Alturas fixas e variadas, como no protótipo: com todas iguais, a onda
   parada (reduced-motion) viraria uma régua. */
const ALTURAS = [40, 70, 30, 90, 50, 65, 35];

/**
 * Equalizador de estação captada. `ativo` liga a animação; parado, as barras
 * ficam nas alturas fixas — o desenho continua dizendo "áudio" sem mexer.
 */
export function OndasEq({
  ativo,
  cor = "var(--brand)",
  altura = 18,
  barras = 7,
}: {
  ativo: boolean;
  cor?: string;
  altura?: number;
  barras?: number;
}) {
  return (
    <span className="inline-flex shrink-0 items-end gap-[2.5px]" style={{ height: altura }} aria-hidden>
      {ALTURAS.slice(0, barras).map((h, i) => (
        <span
          key={i}
          className={ativo ? "eq-barra" : undefined}
          style={{
            width: 3,
            height: `${h}%`,
            background: cor,
            borderRadius: 2,
            animationDelay: `${(i % 3) * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}
