interface AlertaConfigProps {
  titulo: string;
  descricao: string;
  limiar: number;
  unidade: string;
  min: number;
  max: number;
  step: number;
  ativo: boolean;
  cor?: string;
  onChange: (limiar: number, ativo: boolean) => void;
}

export function AlertaConfig({
  titulo,
  descricao,
  limiar,
  unidade,
  min,
  max,
  step,
  ativo,
  cor = "#F97316",
  onChange,
}: AlertaConfigProps) {
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-txt-1">{titulo}</div>
          <div className="mt-0.5 text-xs text-txt-3">{descricao}</div>
        </div>
        {/* Toggle */}
        <button
          onClick={() => onChange(limiar, !ativo)}
          className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200"
          style={{ background: ativo ? cor : "var(--g3)" }}
          aria-label={ativo ? "Desativar alerta" : "Ativar alerta"}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ left: ativo ? "calc(100% - 22px)" : "2px" }}
          />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-txt-2">Limiar</span>
          <span className="font-bold tabular-nums" style={{ color: ativo ? cor : "var(--txt3)" }}>
            {limiar}{unidade}
          </span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={limiar}
          disabled={!ativo}
          onChange={(e) => onChange(Number(e.target.value), ativo)}
          className="w-full accent-current disabled:opacity-40"
          style={{ accentColor: cor }}
        />
        <div className="flex justify-between text-[10px] text-txt-3">
          <span>{min}{unidade}</span>
          <span>{max}{unidade}</span>
        </div>
      </div>
    </div>
  );
}
