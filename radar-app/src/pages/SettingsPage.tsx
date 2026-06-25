import { useState, useEffect } from "react";
import { AlertaConfig } from "@/components/AlertaConfig";

const LS_KEY = "radar_alertas_config";

interface Config {
  iad_limiar: number;
  iad_ativo: boolean;
  neg_limiar: number;
  neg_ativo: boolean;
  tema_limiar: number;
  tema_ativo: boolean;
}

const DEFAULTS: Config = {
  iad_limiar: 40,
  iad_ativo: true,
  neg_limiar: 60,
  neg_ativo: true,
  tema_limiar: 50,
  tema_ativo: false,
};

function loadConfig(): Config {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function SettingsPage() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  }

  function salvar() {
    localStorage.setItem(LS_KEY, JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  useEffect(() => {
    setSaved(false);
  }, [config]);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Configurações</h1>
        <p className="text-sm text-txt-2">Alertas automáticos por limiar — enviados via WhatsApp ao secretário</p>
      </div>

      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-txt-3">
          Alertas por Limiar
        </div>
        <div className="space-y-3">
          <AlertaConfig
            titulo="IAD abaixo do limiar"
            descricao="Dispara quando o Índice de Aprovação Digital cai abaixo do valor configurado"
            limiar={config.iad_limiar}
            unidade="%"
            min={10}
            max={70}
            step={5}
            ativo={config.iad_ativo}
            cor="#EF4444"
            onChange={(limiar, ativo) => {
              set("iad_limiar", limiar);
              set("iad_ativo", ativo);
            }}
          />
          <AlertaConfig
            titulo="% Negativo acima do limiar"
            descricao="Dispara quando o percentual de posts negativos ultrapassa o valor configurado"
            limiar={config.neg_limiar}
            unidade="%"
            min={30}
            max={90}
            step={5}
            ativo={config.neg_ativo}
            cor="#F97316"
            onChange={(limiar, ativo) => {
              set("neg_limiar", limiar);
              set("neg_ativo", ativo);
            }}
          />
          <AlertaConfig
            titulo="Tema em crise por sentimento"
            descricao="Dispara quando um tema específico ultrapassa o % de negatividade configurado"
            limiar={config.tema_limiar}
            unidade="%"
            min={30}
            max={90}
            step={5}
            ativo={config.tema_ativo}
            cor="#8B5CF6"
            onChange={(limiar, ativo) => {
              set("tema_limiar", limiar);
              set("tema_ativo", ativo);
            }}
          />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-txt-3">
          Canal de Notificação
        </div>
        <div className="flex items-center gap-3 text-sm text-txt-2">
          <span className="rounded bg-bg-2 px-2.5 py-1 font-semibold text-txt-1">✔ WhatsApp</span>
          <span className="text-txt-3">via Evolution API (configurado no pipeline)</span>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg-1 p-4 text-xs text-txt-3">
        <div className="font-semibold text-txt-2">Como funciona</div>
        <p className="mt-1">
          O AGORA (pipeline de coleta) lê esta configuração ao final de cada execução (3x/dia).
          Quando um limiar é ultrapassado, uma mensagem é enviada automaticamente pelo WhatsApp
          ao grupo do secretário. A configuração fica salva neste dispositivo.
        </p>
      </div>

      <button
        onClick={salvar}
        className="w-full rounded-xl py-3 text-sm font-bold text-white transition"
        style={{ background: saved ? "#16A34A" : "var(--brand, #3B82F6)" }}
      >
        {saved ? "✔ Configuração salva" : "Salvar configuração"}
      </button>
    </div>
  );
}
