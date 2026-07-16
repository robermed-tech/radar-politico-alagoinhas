import { corTema } from "@/lib/temaColors";

interface PostChipsProps {
  sentimento?: string;
  tema?: string;
  urgencia?: string;
  risco_crise?: string;
}

// Badge translúcido, coerente nos dois temas: fundo = cor a 14%, texto = cor,
// borda = cor a 30%. Nada de cores dark hardcoded (quebravam no tema claro).
function chipStyle(cor: string) {
  return {
    background: `${cor}24`,
    color: cor,
    border: `1px solid ${cor}3d`,
  } as const;
}

const CHIP =
  "rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide capitalize";

const SENT_COR: Record<string, string> = {
  positivo: "#22C55E",
  negativo: "#EF4444",
  neutro: "#8593AD",
};

export function PostChips({ sentimento, tema, urgencia, risco_crise }: PostChipsProps) {
  const sent = sentimento?.toLowerCase();
  const urg = urgencia?.toLowerCase();
  const risco = risco_crise?.toLowerCase();
  return (
    <div className="flex flex-wrap gap-1.5">
      {sent && (
        <span className={CHIP} style={chipStyle(SENT_COR[sent] ?? "#8593AD")}>
          {sent}
        </span>
      )}
      {tema && tema !== "—" && (
        <span className={CHIP} style={chipStyle(corTema(tema))}>
          {tema}
        </span>
      )}
      {(urg === "alta" || urg === "crítica" || urg === "critica") && (
        <span className={CHIP} style={chipStyle("#FB923C")}>
          urgente
        </span>
      )}
      {(risco === "alto" || risco === "crítico" || risco === "critico") && (
        <span className={CHIP} style={chipStyle("#F97316")}>
          risco {risco}
        </span>
      )}
    </div>
  );
}
