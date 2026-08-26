/**
 * Esqueleto de carga padrão das páginas (correção P1 da avaliação de
 * 11/08/26). Antes cada página devolvia um "Carregando…" em texto puro: a
 * tela inteira colapsava para uma linha e reconstruía do zero quando o dado
 * chegava — num painel lido de relance (e em telão) esse pisca custa a
 * âncora visual de onde a pessoa estava.
 *
 * O esqueleto mantém o H1 REAL da página (tipografia padrão de título, então
 * o topo não salta quando o conteúdo entra) e desenha blocos de vidro com um
 * brilho de varredura (.esqueleto-bloco, index.css — transform no compositor,
 * desligado em prefers-reduced-motion).
 *
 * Componente ÚNICO de propósito, a lição do PeriodoFilter/ComentarioBox:
 * página nova usa este componente, nunca um "Carregando…" local.
 */
export function EsqueletoPagina({ titulo }: { titulo: string }) {
  return (
    <div className="space-y-4 p-5" role="status" aria-label={`Carregando ${titulo}`}>
      <div>
        <h1 className="text-[27px] font-semibold leading-tight tracking-tight">{titulo}</h1>
        <div className="esqueleto-bloco mt-2 h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="esqueleto-bloco h-24" />
        ))}
      </div>
      <div className="esqueleto-bloco h-64" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="esqueleto-bloco h-40" />
        <div className="esqueleto-bloco h-40" />
      </div>
    </div>
  );
}
