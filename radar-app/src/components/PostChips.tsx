interface PostChipsProps {
  sentimento?: string;
  tema?: string;
  urgencia?: string;
  risco_crise?: string;
}

export function PostChips({ sentimento, tema, urgencia, risco_crise }: PostChipsProps) {
  const sent = sentimento?.toLowerCase();
  const urg = urgencia?.toLowerCase();
  const risco = risco_crise?.toLowerCase();
  return (
    <div className="flex flex-wrap gap-1.5">
      {sent && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={
            sent === "positivo"
              ? { background: "#14532d", color: "#22c55e" }
              : sent === "negativo"
                ? { background: "#450a0a", color: "#ef4444" }
                : { background: "#1e2a3a", color: "#9fb0cc" }
          }
        >
          {sent}
        </span>
      )}
      {tema && tema !== "—" && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "#1e1b30", color: "#a78bfa" }}>
          {tema}
        </span>
      )}
      {(urg === "alta" || urg === "crítica" || urg === "critica") && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "#44180a", color: "#fb923c" }}>
          urgente
        </span>
      )}
      {(risco === "alto" || risco === "crítico" || risco === "critico") && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "#3a1a0a", color: "#f97316" }}>
          risco {risco}
        </span>
      )}
    </div>
  );
}
