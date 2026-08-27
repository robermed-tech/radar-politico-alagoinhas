/**
 * Antena de rádio — o ícone e o painel de "captando sinais" da Escuta do Rádio.
 *
 * A forma vem da referência que o cliente mandou em 29/07: torre treliçada com
 * X de contraventamento e três arcos de onda saindo de cada lado do foco. O
 * ícone antigo da seção era um aparelho RECEPTOR de rádio (caixinha com dial),
 * que é o objeto errado: a seção não mostra um rádio, mostra a captação do que
 * está no ar.
 *
 * A mesma geometria serve os dois tamanhos (16px na barra lateral, 150px+ no
 * painel) de propósito — é o que faz o item de menu e o card da página serem
 * reconhecidos como a mesma coisa.
 */

// ── Geometria (viewBox 24×24) ────────────────────────────────────────────────
// Foco no alto, torre abaixo. Os arcos varrem ±40° em torno da horizontal: mais
// que isso e a ponta de baixo do arco externo invadia as pernas da torre.
import { FUNDO_ESCUTA, SOMBRA } from "./superficieRadio";

const FOCO = { x: 12, y: 6.4 };
const RAIOS = [3.2, 5.0, 6.8];

/** Um par de arcos (esquerdo + direito) no raio pedido. */
function ParDeOndas({ r }: { r: number }) {
  const dx = r * 0.766; // cos 40°
  const dy = r * 0.643; // sen 40°
  const esq = `M ${(FOCO.x - dx).toFixed(2)} ${(FOCO.y - dy).toFixed(2)} A ${r} ${r} 0 0 0 ${(FOCO.x - dx).toFixed(2)} ${(FOCO.y + dy).toFixed(2)}`;
  const dir = `M ${(FOCO.x + dx).toFixed(2)} ${(FOCO.y - dy).toFixed(2)} A ${r} ${r} 0 0 1 ${(FOCO.x + dx).toFixed(2)} ${(FOCO.y + dy).toFixed(2)}`;
  return (
    <>
      <path d={esq} />
      <path d={dir} />
    </>
  );
}

/** Torre: duas pernas abrindo, dois travessões, X nos dois trechos de baixo. */
function Torre() {
  return (
    <>
      <path d="M10.55 8.6 7.3 21.6" />
      <path d="M13.45 8.6 16.7 21.6" />
      <path d="M9.48 12.9h5.05" />
      <path d="M8.4 17.2h7.2" />
      <path d="M7.3 21.6h9.4" />
      <path d="M9.48 12.9 15.6 17.2" />
      <path d="M14.53 12.9 8.4 17.2" />
      <path d="M8.4 17.2 16.7 21.6" />
      <path d="M15.6 17.2 7.3 21.6" />
    </>
  );
}

/**
 * Ícone estático da antena, em `currentColor`. É o ícone da Escuta do Rádio na
 * barra lateral.
 */
export function IconAntena({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {RAIOS.map((r) => (
        <ParDeOndas key={r} r={r} />
      ))}
      <Torre />
      <circle cx={FOCO.x} cy={FOCO.y} r="1.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Antena animada: os arcos acendem do foco para fora, em sequência, como sinal
 * chegando. Mesma linguagem do radar de coleta da Estação Meteorológica (lá o
 * feixe gira, aqui as ondas chegam) e mesma mecânica: animação CSS de
 * `transform`/`opacity`, que roda no compositor e sobrevive à rolagem, e nunca
 * `requestAnimationFrame` — rAF para em aba oculta e o ícone congelaria num
 * quadro qualquer.
 *
 * TRAÇO FLAT desde 27/08 (pedido do Robério): uma tinta só, cheia, do mesmo
 * peso na torre e nos arcos. Antes o desenho vinha em três forças ao mesmo
 * tempo — arcos fantasma a 28%, torre a 62% e arcos acesos a 95% com um
 * `drop-shadow` de halo por cima —, o que dava o efeito de traço apagado que
 * ele apontou. A camada fantasma existia como desenho de repouso para
 * `prefers-reduced-motion`; esse papel passou para os próprios arcos, que
 * param acesos e completos quando a animação está desligada (ver o @media no
 * <style> abaixo).
 *
 * O que fica: a onda. Cada arco nasce no foco, cresce para fora e some, em
 * sequência, e o traço é sólido o tempo todo em que está visível.
 * Bônus: o painel passou a ter exatamente o mesmo traço do `IconAntena` de
 * 16px da barra lateral, que sempre foi flat — que é justamente o que faz o
 * ícone do menu e o card da página serem lidos como a mesma coisa.
 */
function AntenaCaptando({ ativo, size = 210 }: { ativo: boolean; size?: number }) {
  // Mesmas cores de estado do radar de coleta (COR_RADAR_* em
  // RadarStatusBar.tsx, onda 2 de 03/08): captando = a cor da marca,
  // sem captação = âmbar de atenção. As duas colunas são gêmeas; cor
  // diferente aqui quebraria o "igual" que o cliente pediu em 29/07.
  const cor = ativo ? "#62C2CA" : "#F59E0B";
  // Origem do zoom no foco da antena, não no centro do quadro: a onda tem que
  // nascer da ponta da torre.
  const origem = `${(FOCO.x / 24) * 100}% ${(FOCO.y / 24) * 100}%`;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <style>{`
        /* A onda passa a maior parte do ciclo em opacidade CHEIA: o traço é
           sólido enquanto está no ar, e só o rabo do movimento desvanece —
           sem isso o arco sumiria de estalo no meio do quadro. */
        @keyframes antena-onda {
          0%   { opacity: 0; transform: scale(0.62); }
          12%  { opacity: 1; }
          70%  { opacity: 1; }
          100% { opacity: 0; transform: scale(1.10); }
        }
        .antena-onda { animation: antena-onda 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          /* Sem animação, os três arcos ficam acesos e parados: é o desenho
             completo da antena, que antes vinha de uma camada fantasma. */
          .antena-onda { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 h-full w-full"
        fill="none"
        stroke={cor}
        /* Um peso só para tudo (torre e ondas): peso diferente por camada era a
           outra metade do efeito "apagado" que saiu em 27/08.
           0.6 e não 1.1 (segunda rodada do mesmo dia: "mais fina, moderna,
           tecnológica"). O peso do traço aqui é medido em unidades do viewBox
           de 24, então ele ESCALA com o desenho: num painel de 228px, 1.1
           virava um traço de 10,5px de tela, que é peso de ícone pequeno
           ampliado, não de instrumento. 0.6 dá 5,7px — a treliça da torre volta
           a ser treliça e as ondas ficam com cara de sinal, não de tubo.
           Ao mexer no tamanho do painel, conferir de novo: o que importa é o
           traço em PIXELS, e ele muda junto. */
        strokeWidth="0.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Torre />
        {/* Uma onda por raio, saindo em sequência do foco. */}
        {RAIOS.map((r, i) => (
          <g
            key={r}
            className="antena-onda"
            style={{ animationDelay: `${i * 0.55}s`, transformOrigin: origem }}
          >
            <ParDeOndas r={r} />
          </g>
        ))}
        {/* O foco encolheu junto (1.55 → 0.9): num traço de 0.6 o ponto antigo
            virava um bolo no meio do desenho. Continua mais pesado que a linha,
            porque ele é o nó de onde o sinal sai — cerca de 3x a espessura, que
            é a proporção de nó em desenho técnico. */}
        <circle cx={FOCO.x} cy={FOCO.y} r="0.9" fill={cor} stroke="none" />
      </svg>
    </div>
  );
}

/**
 * Painel vertical da escuta, gêmeo do `RadarStatusColumn` da Estação
 * Meteorológica: mesmo degradê chumbo→quase-preto, mesmo rótulo em caixa alta,
 * mesma linha de status com o ponto luminoso. O cliente pediu "igual ao do
 * radar", e igual aqui quer dizer o mesmo card, não um card parecido — daí as
 * cores e as medidas serem as mesmas em vez de novas.
 *
 * Ícone, texto e respiro (padding/margens) subiram junto em 31/07 — pedido
 * era só sobre esta antena, mas as duas ficam desalinhadas de novo se só uma
 * cresce, então o `RadarStatusColumn` recebeu o mesmo aumento proporcional.
 */
export function AntenaStatusColumn({
  ativo,
  legenda,
  minHeight = 300,
}: {
  ativo: boolean;
  legenda?: string;
  minHeight?: number;
}) {
  const cor = ativo ? "#62C2CA" : "#F59E0B";
  return (
    <div
      className="flex h-full flex-col items-center justify-center overflow-hidden rounded-[28px] px-6 py-8 text-center"
      style={{
        // Superfície importada de superficieRadio.ts — a mesma do radar de
        // coleta e dos dois cards da Rádio Escuta (chumbo quente desde a
        // onda 2 de 03/08, contraste remedido no comentário do token).
        background: FUNDO_ESCUTA,
        minHeight,
        boxShadow: SOMBRA,
      }}
    >
      {/* Corpos e desenho subiram em 27/08, junto com os do RadarStatusColumn
          (o pedido foi "aumenta a antena na mesma proporção"): rótulo 16→18px,
          estado 21→24px, LED 12→14px — os mesmos valores do radar, que é o que
          mantém as duas como o MESMO card e não dois parecidos.
          O desenho vai a 228 e não além: a coluna desta linha é
          `minmax(280px,320px)` e, no pior caso, sobram 232px úteis depois do
          `px-6`. O radar renderiza 210 na Estação Meteorológica pelo mesmo tipo
          de limite — em cada tela, o desenho é o maior que cabe inteiro. */}
      <div
        className="text-[18px] uppercase tracking-[0.16em]"
        style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
      >
        Escuta
      </div>

      {/* Respiro de 32 para 24px pela mesma razão do radar: o desenho cresceu e
          a folga em volta não é dado nenhum. Mantém a linha de topo da Rádio
          Escuta na altura que ela já tinha (~470px, o teto dos cards ao lado). */}
      <div className="my-6">
        <AntenaCaptando ativo={ativo} size={228} />
      </div>

      <div className="flex items-center justify-center gap-2.5">
        <span className="text-[24px] leading-tight text-white" style={{ fontWeight: 800 }}>
          {ativo ? "Captando sinal" : "Sem captação"}
        </span>
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ background: cor, boxShadow: `0 0 10px ${cor}` }}
        />
      </div>
      {legenda && (
        <div className="mt-2 text-[15px]" style={{ color: "rgba(255,255,255,0.72)", fontWeight: 600 }}>
          {legenda}
        </div>
      )}
    </div>
  );
}
