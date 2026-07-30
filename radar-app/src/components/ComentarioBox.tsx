/**
 * Box de comentário — a caixa única em que TODO comentário de cidadão aparece,
 * em qualquer tela do painel.
 *
 * Pedido de 29/07: "padronize os boxes de comentários colocando o fundo igual
 * ao do radar coleta". Antes cada tela tinha o seu: `bg-bg-2` claro na Análise
 * do Clima e na Análise por Perfil, `bg-bg-1` no drill-down das Previsões,
 * `.quote-box` translúcido no Feed e grafite chapado (#1E293B) nos dois modais
 * de coletânea. Agora é o mesmo degradê chumbo→quase-preto do
 * `RadarStatusColumn`, num componente só — a única forma de continuar igual é
 * não haver cinco cópias.
 *
 * ── Contraste ──────────────────────────────────────────────────────────────
 * O degradê tem uma ponta CLARA (#475569), e ela é o pior caso: medido, o texto
 * quase branco dá 7,25:1 e o secundário `#CBD5E1` dá 5,11:1 (os dois passam
 * AA), mas as cores de sentimento dos gráficos reprovam feio ali — vermelho
 * `#EF4444` mede 2,01:1 e nem o `#FCA5A5` mais claro chega ao mínimo (4,0:1).
 * Por isso o rótulo de sentimento é um CHIP com fundo quase sólido escuro em
 * vez de texto colorido solto: é a mesma regra já registrada no CLAUDE.md
 * ("todo elemento auxiliar sobre um degradê precisa do próprio fundo quase
 * sólido, não translúcido"). Sobre o chip, o vermelho claro mede 10:1.
 */
export const FUNDO_COMENTARIO = "linear-gradient(165deg, #475569 0%, #0F172A 100%)";
export const BORDA_COMENTARIO = "1px solid rgba(148,163,184,0.30)";
/** Texto do comentário em si. */
export const TINTA_COMENTARIO = "#F8FAFC";
/** Metadados (autor, curtidas, tema). */
export const TINTA_COMENTARIO_2 = "#CBD5E1";
/** Link sobre o degradê: laranja-200. Mede 5,60:1 na ponta clara e 13,19:1 na
 *  escura. O `--brand` do tema claro (#EA580C) reprovaria com folga (2,13:1), e
 *  o laranja-300 (#FDBA74) parou em 4,49:1 — um centésimo abaixo do AA, medido
 *  e descartado. */
export const TINTA_LINK_COMENTARIO = "#FED7AA";

/** Tons claros das cores de sentimento, para uso DENTRO do chip escuro. */
const TINTA_SENTIMENTO: Record<string, string> = {
  negativo: "#FCA5A5",
  positivo: "#86EFAC",
  neutro: "#CBD5E1",
};

export function tintaSentimento(s: string): string {
  return TINTA_SENTIMENTO[(s || "").toLowerCase()] ?? TINTA_SENTIMENTO.neutro;
}

export function ComentarioBox({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg p-3 ${className}`}
      style={{ background: FUNDO_COMENTARIO, border: BORDA_COMENTARIO }}
    >
      {children}
    </div>
  );
}

/** O texto do comentário. Entre aspas curvas e em peso 600 (pedido de 27/07). */
export function ComentarioTexto({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base leading-relaxed" style={{ color: TINTA_COMENTARIO, fontWeight: 600 }}>
      “{children}”
    </p>
  );
}

/** Linha de metadados sob o comentário. */
export function ComentarioMeta({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px]"
      style={{ color: TINTA_COMENTARIO_2, fontWeight: 500 }}
    >
      {children}
    </div>
  );
}

/**
 * Chip sobre o degradê: fundo quase sólido escuro com texto claro por cima.
 * Nunca um alpha baixo — o degradê varia demais para um translúcido compensar.
 */
export function ComentarioChip({
  children,
  cor = TINTA_COMENTARIO_2,
}: {
  children: React.ReactNode;
  cor?: string;
}) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[12px] font-bold uppercase"
      style={{ background: "rgba(2,6,23,0.88)", color: cor }}
    >
      {children}
    </span>
  );
}
