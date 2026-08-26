/**
 * Marca VIRATEMPO — vetor oficial (MARCA/SVG/Ativo 1.svg), aplicado em 26/08/26
 * junto com a paleta nova (teal #62C2CA / petróleo #04242F / preto).
 *
 * O que mudou em relação ao desenho anterior, e por que:
 *
 * - A wordmark é UM traçado de uma tinta só. O corte "vira" + "tempo" em duas
 *   cores morreu com ele: o arquivo da marca não tem esse corte, e reproduzi-lo
 *   à mão seria inventar uma variante que a marca não tem. Como consequência,
 *   `--brand-text` deixou de ser consumido pela logomarca — ele segue valendo
 *   para marca como LETRA no texto corrido (rótulo, link), que é outro papel.
 * - A wordmark é DESENHO, não texto: nada de `font-family` nem da classe
 *   `.wordmark-vt`, que reproduzia a palavra em Space Grotesk. Fonte não é
 *   marca, e a Space Grotesk nunca foi a tipografia do logotipo.
 * - O anel de varredura saiu da barra lateral e do Login (decisão de 26/08:
 *   "wordmark só, tique no favicon"). O tique quadrado continua existindo em
 *   `TiqueViratempo` porque um favicon de 32px não comporta uma marca cinco
 *   vezes mais larga que alta: ali a palavra vira borrão e o tique não.
 *
 * A caixa é 652,9 x 127,94 (5,10:1). A altura de x ocupa ~52% dela, contra 28%
 * do desenho antigo — no MESMO box a marca real lê maior, então os tamanhos de
 * quem a posiciona caíram junto com a troca. Quem chama define a altura; a
 * largura acompanha.
 */

/** Traçado da wordmark. Herda a tinta de quem posiciona (currentColor). */
function TracadoViratempo() {
  return (
    <g fill="currentColor">
      <path d="M1.92,63.6c6.01,5.69,12.03,11.38,18.04,17.06,2.55,2.41,5.1,5.33,8.25,6.95,5.6,2.89,11.87,1.3,16.38-2.71,12.97-11.51,25.17-24.04,37.71-36.02,4.93-4.71,9.86-9.41,14.78-14.12,5.82-5.56-3.01-14.37-8.82-8.82-10.64,10.16-21.28,20.32-31.92,30.48-5.92,5.65-11.83,11.3-17.75,16.95-.81.78-1.99,2.46-3.05,2.91-2.32.99-4.35-2.15-5.88-3.6-6.31-5.97-12.63-11.94-18.94-17.91-5.83-5.51-14.67,3.29-8.82,8.82h0Z" />
      <path d="M619.88,23.06c-18.23,0-33.02,14.78-33.02,33.02s14.78,33.02,33.02,33.02,33.02-14.78,33.02-33.02-14.78-33.02-33.02-33.02ZM619.88,76.61c-11.34,0-20.54-9.19-20.54-20.54s9.19-20.54,20.54-20.54,20.54,9.19,20.54,20.54-9.19,20.54-20.54,20.54Z" />
      <path d="M108.55,30.27v52.8c0,8.03,12.47,8.04,12.47,0V30.27c0-8.03-12.47-8.04-12.47,0h0Z" />
      <circle cx="114.79" cy="11.51" r="6.2" />
      <path d="M170.57,24.28c-10.05-.09-19.28.39-27.6,6.99-15.53,12.32-12.11,34.26-12.11,51.79,0,8.03,12.47,8.04,12.47,0v-20.62c0-8.51.56-16.56,8.18-22.07,6.36-4.6,14.04-3.66,21.42-3.59,6.6.06,8.27.12,14.86.18,8.03.07,8.04-12.4,0-12.47,0,0-9.83-.14-17.22-.2Z" />
      <path d="M274,37.08h19.22c8.03,0,8.04-12.47,0-12.47h-19.22V6.03c0-8.03-12.47-8.04-12.47,0v18.58h-15.92c-8.03,0-8.04,12.47,0,12.47h15.92v26.84c0,6.4.13,12.43,4.41,17.76,6.89,8.57,17.38,7.35,27.18,7.35,8.03,0,8.04-12.47,0-12.47-6.81,0-18.45,2.3-19.12-7.4-.43-6.3,0-13.67,0-19.98v-12.09Z" />
      <path d="M244.16,86.02c-8.91-14.38-17.82-28.77-26.74-43.14-8.91,14.38-17.82,28.77-26.74,43.14-4.41,7.12-15.67.58-11.25-6.57,1.36-2.2,2.73-4.39,4.09-6.59,9.43-15.22,18.86-30.43,28.29-45.65,1.41-2.27,3.51-3.15,5.58-3.06h.05c2.07-.08,4.18.79,5.58,3.06.04.07.09.15.13.22,9.39,15.15,18.77,30.29,28.16,45.43,1.36,2.2,2.73,4.39,4.09,6.59,4.43,7.15-6.83,13.69-11.25,6.57Z" />
      <path d="M372.05,56.08c0-18.23-14.78-33.02-33.01-33.02s-33.02,14.79-33.02,33.02,14.79,33,33.01,33.01c0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0h0c3.42,0,6.19-2.78,6.19-6.2s-2.77-6.2-6.19-6.2v-.08c-11.35,0-20.54-9.2-20.54-20.53s9.2-20.54,20.54-20.54c9.16,0,16.92,6.01,19.56,14.3h-14.94c-8.02,0-8.03,12.47,0,12.47h22.36c4.02,0,6.03-3.12,6.03-6.23h0Z" />
      <path d="M367.62,55.91v.03h0s0-.02,0-.03Z" />
      <path d="M574.23,78.65c-6.01,6.74-14.65,10.59-23.68,10.59-1.7,0-3.43-.13-5.16-.42-.16-.01-16.69-2.72-16.85-2.75l-.23,37.4c-.01,2.88-3.44,4.46-5.8,4.46h-.03c-.13,0-.26,0-.39-.01-2.78-.28-5.74-1.96-5.73-5.03l.04-42.06c0-4.13,4.34-7.22,8.25-7.22.28,0,.57.03.84.06l22.36,2.79c.92.12,1.8.16,2.64.16,10.51,0,19.19-8.02,19.76-18.26.31-5.33-1.64-10.62-5.33-14.51-3.7-3.92-8.7-6.09-14.06-6.09h-.45c-5.81.15-10.27,2.25-15.4,7.26l-6.44,6.29-34.93,34.58c-2.08,2.08-4.94,3.27-7.83,3.27s-5.51-1.16-7.32-3.28c-1.51-1.76-2.62-4.94-2.63-7.57l-.1-36.08-32.55,32.63-5.91,6.02-5.67,5.71c-.93.93-2.85,2.48-5.29,2.48-.22,0-.44-.01-.65-.04-4.65-.57-7.12-4.66-7.15-11.86l-.16-35.07s-43.3,43.25-45.2,45.16c-5.7,5.7-14.5-3.14-8.82-8.82l50.58-50.84c1.22-1.25,2.92-1.92,4.9-1.92,2.24,0,4.65.87,6.44,2.34,2.43,1.99,4.14,5.86,4.18,9.41l.16,32.49,42.09-42.32c1.47-1.47,3.44-1.79,4.84-1.79s2.88.32,4.18.9c6.54,2.96,6.48,11.41,6.42,18.84v.97c-.01.64-.01,1.26,0,1.87l.17,25.14,34.75-34.26,9.02-8.24c5.26-3.76,11.45-5.75,17.91-5.75,4.18,0,8.44.83,12.67,2.44,8.78,3.34,15.94,11.36,18.7,20.91,2.99,10.42.32,21.63-7.16,30.02Z" />
    </g>
  );
}

/**
 * Wordmark. `altura` em px; a largura sai da proporção do vetor.
 *
 * `mono` não existe mais: a marca já é de uma tinta só, e o parâmetro só fazia
 * sentido quando havia duas. Quem precisa de outra cor passa `className` com a
 * cor do texto (ex.: `text-white` no painel escuro do Login).
 */
export function WordmarkViratempo({
  altura = 20,
  className = "",
}: {
  altura?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 652.9 127.94"
      height={altura}
      width={altura * (652.9 / 127.94)}
      className={className}
      role="img"
      aria-label="Viratempo"
    >
      <TracadoViratempo />
    </svg>
  );
}

/**
 * Tique isolado (o "v" que abre a palavra), centrado numa caixa quadrada — a
 * assinatura curta para onde a palavra inteira não cabe: favicon, ícone do app
 * e carimbo do rodapé do relatório em PDF.
 *
 * O encaixe vem da caixa MEDIDA do glifo (98,98 x 64,89 dentro do viewBox da
 * marca), não de olho: por isso o transform tem casas decimais. Refazer a
 * conta se o arquivo da marca mudar.
 */
export function TiqueViratempo({
  tamanho = 32,
  className = "",
}: {
  tamanho?: number;
  className?: string;
}) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(10, 6.82) scale(0.4445)" fill="currentColor">
        <path d="M1.92,63.6c6.01,5.69,12.03,11.38,18.04,17.06,2.55,2.41,5.1,5.33,8.25,6.95,5.6,2.89,11.87,1.3,16.38-2.71,12.97-11.51,25.17-24.04,37.71-36.02,4.93-4.71,9.86-9.41,14.78-14.12,5.82-5.56-3.01-14.37-8.82-8.82-10.64,10.16-21.28,20.32-31.92,30.48-5.92,5.65-11.83,11.3-17.75,16.95-.81.78-1.99,2.46-3.05,2.91-2.32.99-4.35-2.15-5.88-3.6-6.31-5.97-12.63-11.94-18.94-17.91-5.83-5.51-14.67,3.29-8.82,8.82h0Z" />
      </g>
    </svg>
  );
}

/**
 * Nome antigo do tique, preservado para não quebrar import de fora. O símbolo
 * que ele nomeava (anel de radar com feixe em degradê) não existe mais.
 */
export const SimboloViratempo = TiqueViratempo;
