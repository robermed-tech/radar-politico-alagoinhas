import { useEffect, useRef, useState } from "react";

/**
 * Número que conta até o valor real ao entrar na tela (onda 2 do redesign,
 * 03/08: "contagem de posts e comentários" viva, do briefing).
 *
 * Usa requestAnimationFrame, e isso NÃO fere a regra "nunca rAF" do
 * velocímetro/antena: lá o rAF era dono de um estado CONTÍNUO (o ângulo de
 * repouso da agulha), e a aba oculta congelava o desenho num valor errado
 * para sempre. Aqui o rAF é uma rampa de ~0,9s cujo último quadro grava o
 * valor exato (`p >= 1` → `valor`), e o estado de repouso é o número
 * verdadeiro: se a aba estiver oculta, a rampa simplesmente termina quando
 * ela voltar a ficar visível — que é quando existe alguém olhando.
 *
 * `prefers-reduced-motion` pula a rampa e mostra o valor direto.
 */
export function ContadorAnimado({
  valor,
  formatar = (n: number) => String(n),
  duracaoMs = 900,
}: {
  valor: number;
  formatar?: (n: number) => string;
  duracaoMs?: number;
}) {
  // Nasce em 0 de propósito: a primeira rampa é a do carregamento da tela.
  const [mostrado, setMostrado] = useState(0);
  const partida = useRef(0);

  useEffect(() => {
    const de = partida.current;
    partida.current = valor;
    if (
      de === valor ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setMostrado(valor);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / duracaoMs);
      const suave = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      setMostrado(Math.round(de + (valor - de) * suave));
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    // Garantia por timer (04/08): navegador embutido/economia de energia pode
    // estrangular o rAF e deixar o número parado no 0 por segundos — foi o
    // print do cliente ("0%" com clima de 60+). O timer fixa o valor final
    // mesmo se nenhum quadro de animação rodar; se a rampa já terminou, o
    // setState com o mesmo valor não re-renderiza nada.
    const garantia = window.setTimeout(() => setMostrado(valor), duracaoMs + 300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(garantia);
    };
  }, [valor, duracaoMs]);

  return <>{formatar(mostrado)}</>;
}
