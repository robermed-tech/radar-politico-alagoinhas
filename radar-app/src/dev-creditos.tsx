// Harness do monitoramento de créditos (creditos-dev.html).
//
// Existe por causa do defeito que ele confere: a MESMA linha de
// `service_status` era escrita de dois jeitos em duas telas ("US$ 29,33" no
// banner de saúde, "$29.33 · 101%" na Configuração). Aqui as duas superfícies
// são renderizadas LADO A LADO com o mesmo dado, então a divergência, se
// voltar, aparece na hora — em vez de depender de alguém abrir as duas telas
// com login de admin.
//
// Rodar: npm run dev e abrir /creditos-dev.html (?tema=light alterna o tema).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CartaoCredito } from "./components/CartaoCredito";
import { PipelineHealthBanner } from "./components/PipelineHealthBanner";
import type { PipelineHealth, ServiceStatus } from "./lib/data";
import "./index.css";

function status(over: Partial<ServiceStatus>): ServiceStatus {
  return {
    tenant: "alagoinhas",
    servico: "apify",
    uso_pct: 0,
    uso_usd: 0,
    teto_usd: 29,
    atualizado_em: new Date().toISOString(),
    ...over,
  };
}

// O caso real de 06/08/26 — o que estava na tela quando o cliente apontou a
// divergência.
const ESTOURADO = status({ uso_pct: 101.1, uso_usd: 29.3303, teto_usd: 29 });

const CASOS: { titulo: string; s: ServiceStatus | null }[] = [
  { titulo: "Estourado (caso real: 101,1% do teto)", s: ESTOURADO },
  { titulo: "Crítico (92,4%)", s: status({ uso_pct: 92.4, uso_usd: 26.8, teto_usd: 29 }) },
  { titulo: "Atenção (78%) — acima do limiar do WhatsApp", s: status({ uso_pct: 78, uso_usd: 22.62, teto_usd: 29 }) },
  { titulo: "Normal (4,3%)", s: status({ uso_pct: 4.3, uso_usd: 1.247, teto_usd: 29 }) },
  { titulo: "Sem leitura no banco", s: null },
];

/** Saúde do pipeline no estado "coleta vazia" — é o que acende o banner. */
const SAUDE: PipelineHealth = {
  tenant: "alagoinhas",
  executado_em: new Date(Date.now() - 3 * 3600_000).toISOString(),
  duracao_s: 42,
  posts_coletados: 0,
  posts_analisados: 0,
  alertas_enviados: 0,
  status: "coleta_vazia",
};

function clienteCom(s: ServiceStatus | null): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  qc.setQueryData(["service-status-apify"], s);
  qc.setQueryData(["service-status-anthropic"], s ? { ...s, servico: "anthropic", teto_usd: 25 } : null);
  qc.setQueryData(["alert-history"], []);
  return qc;
}

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
    {CASOS.map((c) => (
      <section key={c.titulo} style={{ marginBottom: 28 }}>
        <div style={{ font: "700 14px/1.4 system-ui", marginBottom: 8, color: "var(--txt1)" }}>
          {c.titulo}
        </div>
        <QueryClientProvider client={clienteCom(c.s)}>
          {/* Banner de saúde: só nomeia o crédito quando o consumo passa do teto. */}
          <PipelineHealthBanner health={SAUDE} />
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <CartaoCredito
              nome="Apify"
              status={c.s}
              descricao="Serviço que coleta as publicações e os comentários do Instagram."
              vazio="Sem leitura ainda — aparece aqui depois da próxima execução do ÁGORA."
              acao="Com o teto fechado a coleta volta com 0 posts. Recarregue em apify.com/billing."
            />
            <CartaoCredito
              nome="Anthropic"
              status={c.s ? { ...c.s, servico: "anthropic", teto_usd: 25, uso_usd: (c.s.uso_pct / 100) * 25 } : null}
              descricao="Modelo que classifica sentimento, tema e risco. Consumo estimado deste pipeline."
              vazio="Sem leitura ainda — o consumo aparece depois da próxima execução do ÁGORA."
              acao="Sem crédito, a análise é gravada com valores padrão. Compre crédito em console.anthropic.com."
            />
          </div>
        </QueryClientProvider>
      </section>
    ))}
  </div>
);
