interface PostChipsProps {
  sentimento?: string;
  tema?: string;
  risco_crise?: string;
}

const CHIP =
  "rounded-md px-1.5 py-0.5 text-[12px] font-bold tracking-wide frase-cap";

/* Prévia 2 de 04/08: a reação ganha NOME ("reação crítica"), não só cor — e a
   cor da letra vem das tintas de sentimento (tokens), não do par de gráfico
   (#22C55E media 2,3:1 como texto de 12px). O chip de tema perdeu a cor por
   categoria, como nos Pedidos: cor de tema não é semântica do painel. */
const SENT_CHIP: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  positivo: { rotulo: "reação favorável", cor: "var(--sent-ink-pos)", fundo: "rgba(21,128,61,0.10)" },
  negativo: { rotulo: "reação crítica", cor: "var(--sent-ink-neg)", fundo: "rgba(185,28,28,0.10)" },
  neutro: { rotulo: "reação neutra", cor: "var(--txt3)", fundo: "var(--quote-bg)" },
};

// O chip de urgência saiu na revisão de 25/07 — o cliente não quer aviso de
// urgência na leitura dos posts.
export function PostChips({ sentimento, tema, risco_crise }: PostChipsProps) {
  const sent = SENT_CHIP[sentimento?.toLowerCase() ?? ""];
  const risco = risco_crise?.toLowerCase();
  return (
    <div className="flex flex-wrap gap-1.5">
      {sent && (
        <span className={CHIP} style={{ background: sent.fundo, color: sent.cor }}>
          {sent.rotulo}
        </span>
      )}
      {tema && tema !== "—" && (
        <span className={`${CHIP} border border-line bg-bg-2 text-txt-2`}>
          {tema}
        </span>
      )}
      {(risco === "alto" || risco === "crítico" || risco === "critico") && (
        // Laranja de RISCO (sistema paralelo de alerta), não a marca.
        <span className={CHIP} style={{ background: "rgba(249,115,22,0.14)", color: "var(--warning)" }}>
          risco {risco}
        </span>
      )}
    </div>
  );
}
