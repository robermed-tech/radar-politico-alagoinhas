/**
 * Marca VIRATEMPO (aprovada em 21/08/26, prévia aprovacao-viratempo.html).
 *
 * O símbolo une as duas metáforas que o painel já usa: o RADAR (a varredura
 * que gira sem parar, o mesmo movimento da Estação Meteorológica) e o TEMPO
 * QUE VIRA (o setor em degradê é feixe de radar e ponteiro de relógio ao
 * mesmo tempo, com os ecos de sinal à esquerda). Geometria pura em SVG:
 * anima por transform (classe .vt-varredura, keyframes no index.css, a regra
 * do compositor de sempre) e funciona parada com prefers-reduced-motion.
 *
 * O anel e o miolo usam currentColor: quem posiciona o símbolo escolhe a
 * tinta pela cor do texto ao redor (chumbo no claro, creme no escuro,
 * #1A0F02 sobre a marca). O setor fica no degradê da família do #F79641,
 * exceto sobre fundo da própria marca, onde `setorEscuro` o leva para a
 * tinta escura (a regra de contraste dos botões de marca).
 */
export function SimboloViratempo({
  tamanho = 32,
  animado = true,
  setorEscuro = false,
  className = "",
}: {
  tamanho?: number;
  animado?: boolean;
  setorEscuro?: boolean;
  className?: string;
}) {
  const setor = setorEscuro ? "#1A0F02" : "url(#vt-grad-marca)";
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="vt-grad-marca" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFBE78" />
          <stop offset="0.55" stopColor="#F79641" />
          <stop offset="1" stopColor="#D97A26" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="3.5" opacity="0.9" />
      <path
        d="M14 20 A22 22 0 0 1 24 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M10 27 A28 28 0 0 1 20 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.3"
      />
      <g className={animado ? "vt-varredura" : undefined}>
        <path d="M32 32 L32 10 A22 22 0 0 1 47.6 16.4 Z" fill={setor} />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Wordmark: "vira" na tinta do texto, "tempo" na marca-como-letra
 * (--brand-text, o token que passa AA nos dois temas). A classe .wordmark-vt
 * (index.css) põe a Space Grotesk com font-synthesis-weight: none.
 * `mono` força uma tinta só (para fundos onde o --brand-text não passa,
 * como a banda laranja: lá tudo é #1A0F02 herdado do pai).
 */
export function WordmarkViratempo({ mono = false, className = "" }: { mono?: boolean; className?: string }) {
  return (
    <span className={`wordmark-vt ${className}`}>
      vira<em style={mono ? { color: "inherit" } : undefined}>tempo</em>
    </span>
  );
}
