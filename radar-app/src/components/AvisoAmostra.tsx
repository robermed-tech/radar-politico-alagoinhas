/**
 * Aviso destacado quando a amostra é fraca (ICA < 40). Sinaliza que os índices
 * podem oscilar e não devem ser lidos como verdade absoluta.
 */
export function AvisoAmostra({ ica, posts }: { ica: number; posts?: number }) {
  if (ica >= 40) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-4"
      style={{ borderColor: "rgba(234,179,8,0.5)", background: "rgba(234,179,8,0.08)" }}
      role="alert"
    >
      <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ fill: "#EAB308" }}>
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      </svg>
      <div>
        <div className="text-sm font-bold" style={{ color: "#EAB308" }}>
          Amostra insuficiente — interprete com cautela
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-txt-2">
          A confiança da amostra (ICA) está em <b>{ica}/100</b>
          {posts != null ? `, com apenas ${posts} posts no período` : ""}. Com poucos
          dados, os índices abaixo podem oscilar bastante. Amplie o período ou aguarde
          as próximas coletas antes de tomar decisões.
        </p>
      </div>
    </div>
  );
}
