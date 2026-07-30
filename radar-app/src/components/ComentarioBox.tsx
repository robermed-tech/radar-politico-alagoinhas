/**
 * Box de comentário — a caixa única em que TODO comentário de cidadão aparece,
 * em qualquer tela do painel.
 *
 * Fundo: **vidro claro translúcido** (`bg-bg-2`), o mesmo material dos outros
 * cards do painel. Revisão de 30/07, que reverte o degradê chumbo→quase-preto
 * adotado em 29/07: com o box escuro repetido cinco ou seis vezes seguidas a
 * lista virava uma parede preta no meio de uma página clara. O componente único
 * continua — o que mudou foi a superfície, num lugar só.
 *
 * `bg-bg-2` é `rgba(255,255,255,0.55)` no tema claro e `rgba(255,255,255,0.04)`
 * no escuro: é branco translúcido nos dois, e é o que faz o box acompanhar o
 * tema em vez de ser uma ilha clara dentro do modo escuro.
 *
 * ── Contraste ──────────────────────────────────────────────────────────────
 * Sobre o vidro claro (#FFFCF9 no tema claro, #141414 no escuro) o texto usa os
 * tokens do tema e passa com folga: 18,3:1 e 17,0:1 no texto do comentário,
 * 8,6:1 e 9,8:1 nos metadados.
 *
 * O que NÃO serve aqui é o par de cores de gráfico: `#22C55E` mede 2,3:1 sobre
 * o vidro claro, e até o `--success` do tema (`#16A34A`) para em 3,22:1 — os
 * dois abaixo do AA para um chip de 12px. Por isso existem `--sent-ink-pos` /
 * `--sent-ink-neg` / `--sent-ink-link`, resolvidos por tema (verde-700 e
 * vermelho-700 no claro; os tons claros no escuro), medindo 4,91:1 e 6,33:1 no
 * pior caso. Regra geral do painel: cor de série de gráfico é preenchimento,
 * não tinta de texto.
 */
export const TINTA_SENTIMENTO_POS = "var(--sent-ink-pos)";
export const TINTA_SENTIMENTO_NEG = "var(--sent-ink-neg)";
/** Link dentro do box (ex.: "ver post"). */
export const TINTA_LINK_COMENTARIO = "var(--sent-ink-link)";

export function tintaSentimento(s: string): string {
  const v = (s || "").toLowerCase();
  if (v === "negativo") return TINTA_SENTIMENTO_NEG;
  if (v === "positivo") return TINTA_SENTIMENTO_POS;
  return "var(--txt2)";
}

export function ComentarioBox({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-bg-2 p-3 ${className}`}>{children}</div>
  );
}

/** O texto do comentário. Entre aspas curvas e em peso 600 (pedido de 27/07). */
export function ComentarioTexto({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base leading-relaxed text-txt-1" style={{ fontWeight: 600 }}>
      “{children}”
    </p>
  );
}

/** Linha de metadados sob o comentário. */
export function ComentarioMeta({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px] text-txt-2"
      style={{ fontWeight: 500 }}
    >
      {children}
    </div>
  );
}

/**
 * Chip de sentimento/tema. Sobre o vidro claro ele é um fundo tingido leve com
 * a tinta por cima — o inverso da versão escura, que precisava de um fundo
 * quase sólido para isolar o texto do degradê.
 */
export function ComentarioChip({
  children,
  cor = "var(--txt2)",
}: {
  children: React.ReactNode;
  cor?: string;
}) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[12px] font-bold uppercase"
      style={{ color: cor, background: "var(--g3)" }}
    >
      {children}
    </span>
  );
}
