// Harness de desenvolvimento da revisão responsiva de 06/08 (responsivo-dev.html).
// Não entra no bundle do app: é uma entrada Vite separada, usada só no dev
// server para verificar em viewport de celular os COMPONENTES REAIS que a
// revisão tocou — banner de saúde do pipeline (com o X de fechar e o estado
// "créditos da Apify esgotados", dispensável por causa), a lista "Temas que
// merecem atenção", a faixa do radar (ociosa quando o pipeline está com
// problema) e a linha de topo da Rádio Escuta (antena + cadastro + gravar,
// a do corte lateral da 2ª rodada) — sem depender de login no Supabase: as
// queries chegam pré-populadas no cache do React Query e nada sai para a
// rede.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PipelineHealthBanner } from "./components/PipelineHealthBanner";
import { RadarStatusBar } from "./components/RadarStatusBar";
import { TemasEmCrise } from "./pages/ClimaPage";
import { AntenaStatusColumn } from "./components/AntenaSinal";
import { RadiosMonitoradas } from "./components/RadiosMonitoradas";
import { GravarAgora } from "./components/GravarAgora";
import type { PipelineHealth, Briefing } from "./lib/data";
import type { RadioFonte } from "./lib/radio";
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

// Rádio Escuta: quatro estações como no cadastro real (uma pausada, URLs
// longas), para reproduzir o corte lateral dos cards no celular.
const RADIOS: RadioFonte[] = [
  {
    id: "r1", handle: "https://a.cdni.live/radio93fm-bahia/stream.m3u8", label: "93 FM",
    active: false, config: { programas: [] }, created_at: "2026-07-29T10:00:00Z",
  },
  {
    id: "r2", handle: "https://stream.zeno.fm/alagoinhas-fm-104", label: "Alagoinhas FM",
    active: true,
    config: { programas: [{ nome: "Manhã Total", hora_inicio: "07:00", duracao_min: 30, dias: ["seg", "ter", "qua", "qui", "sex"] }] },
    created_at: "2026-07-29T10:00:00Z",
  },
  {
    id: "r3", handle: "https://servidor29.brlogic.com:7104/live", label: "Rádio Boa FM",
    active: true, config: { programas: [] }, created_at: "2026-07-30T10:00:00Z",
  },
  {
    id: "r4", handle: "https://ice.fabricahost.com.br/radiosociedade", label: "Sociedade AM",
    active: true,
    config: { programas: [{ nome: "Jornal da Manhã", hora_inicio: "08:00", duracao_min: 60 }] },
    created_at: "2026-07-30T10:00:00Z",
  },
];
qc.setQueryData(["radios"], RADIOS);

const HEALTH_COLETA_VAZIA: PipelineHealth = {
  tenant: "alagoinhas",
  executado_em: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  duracao_s: 60, posts_coletados: 0, posts_analisados: 0, alertas_enviados: 0,
  status: "coleta_vazia",
};
// O radar lê a MESMA queryKey do banner: com a coleta vazia acima, o radar da
// página tem que abrir OCIOSO (âmbar, sem giro) — critério de 06/08.
qc.setQueryData(["pipeline-health"], HEALTH_COLETA_VAZIA);
// Cenário real de 06/08: Apify no teto (101,1%). O aviso de coleta vazia deve
// nomear a causa e o valor, em vez de listar três hipóteses.
qc.setQueryData(["service-status-apify"], {
  tenant: "alagoinhas", servico: "apify",
  uso_pct: 101.1, uso_usd: 29.3294, teto_usd: 29,
  atualizado_em: new Date().toISOString(),
});

// Segundo cliente com pipeline SAUDÁVEL: prova o estado "Radar em varredura"
// lado a lado com o ocioso, sem os dois caches brigarem pela mesma chave.
const qcSaudavel = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
qcSaudavel.setQueryData(["coleta-logs-hoje"], [{
  id: "1", source_id: null, platform: "instagram", data_type: "posts",
  items_count: 37, status: "ok", collected_at: new Date().toISOString(), source: null,
}]);
qcSaudavel.setQueryData(
  ["coleta-fontes-unificadas"],
  Array.from({ length: 14 }, (_, i) => ({
    id: String(i), platform: "instagram", handle: `fonte${i}`, label: null, active: true,
  }))
);
qcSaudavel.setQueryData(["pipeline-health"], {
  ...HEALTH_COLETA_VAZIA, posts_coletados: 37, status: "ok",
});
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
                color: "#04242F",
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
            {/* Coleta vazia (cache principal) ⇒ deve abrir "Radar ocioso". */}
            <RadarStatusBar />
            {/* Pipeline saudável ⇒ deve abrir "Radar em varredura". */}
            <QueryClientProvider client={qcSaudavel}>
              <RadarStatusBar />
            </QueryClientProvider>
            <TemasEmCrise alertas={ALERTAS} urlsNoPeriodo={new Set(URLS)} />

            {/* Linha de topo da Rádio Escuta — o MESMO grid da RadioPage,
                com os componentes reais (o corte lateral de 06/08 nascia do
                min-content do formulário do cadastro). */}
            <div className="grid gap-3 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_380px]">
              <div className="min-w-0">
                <AntenaStatusColumn ativo legenda="3 estações no ar" />
              </div>
              <div className="min-w-0">
                <RadiosMonitoradas />
              </div>
              <div className="min-w-0">
                <GravarAgora />
              </div>
            </div>
          </div>
        </main>
      </div>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);
