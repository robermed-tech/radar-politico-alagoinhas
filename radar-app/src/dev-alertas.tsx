// Harness de desenvolvimento do recorte por período dos planos de crise
// (alertas-dev.html). Mesmo padrão do dev-icones.tsx / dev-clima.tsx: entrada
// Vite separada, fora do bundle de produção, com o cache do react-query
// pré-populado para ver a AlertasAcoesPage REAL sem login e sem rede.
//
// Cenários:
//   A) crise recente na janela  — cards com a idade do alerta ao lado do nível
//   B) janela sem plano nenhum  — o estado vazio novo (antes a seção sumia)
//
// Rodar: npm run dev e abrir /alertas-dev.html (?tema=light alterna o tema).
// Exige o .env do projeto preenchido, com qualquer valor: o createClient do
// supabase-js lança se a URL vier vazia. Nenhuma chamada de rede é feita.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./components/AuthProvider";
import { AlertasAcoesPage } from "./pages/AlertasAcoesPage";
import type { Briefing, CrisisPlan } from "./lib/data";
import "./index.css";

const agora = Date.now();
const hAtras = (h: number) => new Date(agora - h * 3_600_000).toISOString();

const BRIEFING: Briefing = {
  dia: new Date().toISOString().slice(0, 10),
  periodo: "dia",
  nivel_crise: "moderado",
  risco: 42,
  diagnostico: "Diagnóstico de exemplo do harness.",
  oportunidades: [{ titulo: "Divulgar a entrega da creche", acao: "Publicar vídeo com a diretora", impacto: "alto" }],
  alertas: [],
  recomendacoes: [],
  gerado_em: hAtras(2),
};

const PLANOS: CrisisPlan[] = [
  {
    post_url: "https://www.instagram.com/p/exemplo1/",
    autor: "soulucianoalmeida",
    e_crise_real: true,
    nivel: "critico",
    tema: "saude",
    pavio: "Vídeo denunciando falta de médicos no posto do Mangalô, com 180 comentários em 3 horas.",
    velocidade: "acelerando",
    janela_resposta: "imediato",
    plano_contencao: ["Nota da Secretaria de Saúde", "Agendar visita do secretário"],
    risco_se_ignorar: "A denúncia vira pauta da rádio amanhã cedo.",
    score_risco: 88,
    gerado_em: hAtras(3),
  },
  {
    post_url: "https://www.instagram.com/p/exemplo2/",
    autor: "alagoinhas24h",
    e_crise_real: true,
    nivel: "alto",
    tema: "obras",
    pavio: "Matéria sobre buraco na Juracy Magalhães repercutindo com fotos de moradores.",
    velocidade: "estavel",
    janela_resposta: "24h",
    plano_contencao: ["Informar cronograma da obra"],
    risco_se_ignorar: "Acúmulo de reclamações no mesmo corredor viário.",
    score_risco: 71,
    gerado_em: hAtras(30),
  },
  {
    post_url: "https://www.instagram.com/p/exemplo3/",
    autor: "jaldicenunes",
    e_crise_real: false,
    nivel: "baixo",
    tema: "comunicacao",
    pavio: "Post de campanha sem acusação específica; score alto vem do perfil, não do conteúdo.",
    velocidade: "estavel",
    janela_resposta: "esta semana",
    plano_contencao: ["Não responder"],
    risco_se_ignorar: "Nenhum.",
    score_risco: 72,
    gerado_em: hAtras(5),
  },
];

function cliente(planos: CrisisPlan[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  for (const p of ["dia", "semana", "mes"]) qc.setQueryData(["briefing", p], BRIEFING);
  // A tela abre em 24h (dias = 1); as outras janelas ficam populadas para o
  // clique nos filtros não disparar rede.
  for (const d of [1, 7, 30]) qc.setQueryData(["crisis-plans", d], planos);
  return qc;
}

function Cenario({ titulo, nota, planos }: { titulo: string; nota: string; planos: CrisisPlan[] }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ padding: "10px 20px", font: "700 15px/1.4 system-ui, sans-serif", background: "#111", color: "#fff" }}>
        {titulo}
        <div style={{ font: "400 13px/1.5 system-ui, sans-serif", opacity: 0.75, marginTop: 2 }}>{nota}</div>
      </div>
      <QueryClientProvider client={cliente(planos)}>
        <AuthProvider>
          <AlertasAcoesPage />
        </AuthProvider>
      </QueryClientProvider>
    </section>
  );
}

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(
  <>
    <Cenario
      titulo="A) COM CRISE NA JANELA — 2 reais (há 3h e há 1 dia) + 1 descartada como ruído"
      nota="Cada card mostra agora a IDADE do alerta ao lado do nível. O terceiro plano não aparece: e_crise_real = false."
      planos={PLANOS}
    />
    <Cenario
      titulo="B) JANELA SEM NENHUM PLANO — o caso real de hoje nas últimas 24h"
      nota="Antes a seção sumia sem explicação (o filtro só afetava o briefing). Agora diz que não houve alerta no período."
      planos={[]}
    />
  </>
);
