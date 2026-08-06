// Harness de desenvolvimento da revisão responsiva de 06/08 (responsivo-dev.html).
// Não entra no bundle do app: é uma entrada Vite separada, usada só no dev
// server para verificar em viewport de celular os COMPONENTES REAIS que a
// revisão tocou — banner de saúde do pipeline (com o X de fechar), a lista
// "Temas que merecem atenção" e a faixa do radar — sem depender de login no
// Supabase: as queries chegam pré-populadas no cache do React Query e nada
// sai para a rede.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PipelineHealthBanner } from "./components/PipelineHealthBanner";
import { RadarStatusBar } from "./components/RadarStatusBar";
import { TemasEmCrise } from "./pages/ClimaPage";
import type { PipelineHealth, Briefing } from "./lib/data";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

const URLS = ["https://instagram.com/p/dev-a/", "https://instagram.com/p/dev-b/"];

// Contadores dos temas (45 neg / 2 pos em saúde, como no print do cliente).
qc.setQueryData(
  ["comentarios-tema-todos"],
  [
    ...Array.from({ length: 45 }, () => ({ urlPost: URLS[0], tema: "saude", sentimento: "negativo" })),
    { urlPost: URLS[0], tema: "saude", sentimento: "positivo" },
    { urlPost: URLS[0], tema: "saude", sentimento: "positivo" },
    { urlPost: URLS[1], tema: "obras", sentimento: "negativo" },
    { urlPost: URLS[1], tema: "obras", sentimento: "negativo" },
  ]
);
// Radar: 14 fontes ativas, 1 execução com 0 itens (o cenário do print).
qc.setQueryData(
  ["coleta-logs-hoje"],
  [{
    id: "1", source_id: null, platform: "instagram", data_type: "posts",
    items_count: 0, status: "ok", collected_at: new Date().toISOString(), source: null,
  }]
);
qc.setQueryData(
  ["coleta-fontes-unificadas"],
  Array.from({ length: 14 }, (_, i) => ({
    id: String(i), platform: "instagram", handle: `fonte${i}`, label: null, active: true,
  }))
);

const HEALTH_COLETA_VAZIA: PipelineHealth = {
  tenant: "alagoinhas",
  executado_em: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  duracao_s: 60, posts_coletados: 0, posts_analisados: 0, alertas_enviados: 0,
  status: "coleta_vazia",
};
const HEALTH_PARADO: PipelineHealth = {
  ...HEALTH_COLETA_VAZIA,
  executado_em: new Date(Date.now() - 20 * 3_600_000).toISOString(),
  status: "ok",
  posts_coletados: 12,
};

const ALERTAS: Briefing["alertas"] = [
  {
    nivel: "critico",
    tema: "Cirurgias atrasadas, boatos de fechamento e narrativa de abandono da saúde pública ganham corpo na imprensa",
    tema_categoria: "saude",
    janela: "24h",
  },
  {
    nivel: "moderado",
    tema: "Volume crescente de comentários e campo aberto para crítica exige posicionamento preventivo da gestão",
    tema_categoria: "obras",
    janela: "esta semana",
  },
];

// Estado limpo a cada carga: sem isto, um X clicado numa rodada anterior do
// harness esconderia o banner e o teste deixaria de ser reprodutível.
localStorage.removeItem("radar_aviso_coleta_fechado");

// O app aplica o tema por classe no <html> (App.tsx); sem ela os tokens caem
// no default escuro. O harness espelha o tema claro, que é o que o cliente usa.
document.documentElement.className = "theme-light";

// HMR: recarrega a página em vez de recriar o root.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

function Shell() {
  return (
    <QueryClientProvider client={qc}>
      {/* Réplica do shell do App.tsx: nav mobile, banner e main com o mesmo
          overflow da correção — o scrollWidth medido aqui vale como medida
          da página real. */}
      <div className="flex flex-col" style={{ height: "100vh", background: "var(--bg-page)" }}>
        <div className="flex items-center gap-1 border-b border-line bg-bg-1 p-2">
          <div className="flex flex-1 gap-1 overflow-x-auto">
            <button
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{
                background: "var(--brand)",
                boxShadow: "0 8px 22px -6px var(--brand-glow), inset 0 1px 0 rgba(255,255,255,0.28)",
                color: "#1A0F02",
              }}
            >
              Estação Meteorológica
            </button>
            <button className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-txt-2">
              Análise do Clima
            </button>
          </div>
        </div>

        {/* Aviso de coleta vazia (COM o X) e, abaixo, o estado crítico (SEM X,
            de propósito) — na página real aparece um por vez. */}
        <PipelineHealthBanner health={HEALTH_COLETA_VAZIA} />
        <PipelineHealthBanner health={HEALTH_PARADO} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="space-y-4 p-5">
            <RadarStatusBar />
            <TemasEmCrise alertas={ALERTAS} urlsNoPeriodo={new Set(URLS)} />
          </div>
        </main>
      </div>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);
