// Harness de desenvolvimento da página Previsões (temas-dev.html).
//
// Mesmo padrão do dev-clima: entrada Vite separada, fora do bundle, que monta
// a TemasPage REAL com o cache do react-query pré-populado — sem login e sem
// rede. Existe para conferir as duas peças do modelo Viratempo (21/08/26):
//
//   1) Trajetória do clima: a curva com os NÓS dos marcos (pico/virada em
//      vermelho, alívio em âmbar, última leitura na marca) e o traçado que se
//      desenha na entrada.
//   2) Termômetro de temas em faixas: ranking tingido pela temperatura da
//      crítica (receita dos cards semânticos: degradê claro + tinta #1A0F02),
//      com a decomposição abrindo no clique.
//
// Rodar: npm run dev e abrir /temas-dev.html (?tema=light alterna o tema).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./components/AuthProvider";
import { TemasPage } from "./pages/TemasPage";
import type { DailyTheme, SubtemaStat, ComentarioTema } from "./lib/data";
import "./index.css";

function diaISO(atras: number): string {
  const d = new Date();
  d.setDate(d.getDate() - atras);
  return d.toISOString().slice(0, 10);
}

/**
 * Curva global de % de críticas com uma história legível: sobe até um pico
 * (crise) por volta de 24 dias atrás, alivia, e fecha em queda suave. Cada
 * tema recebe um deslocamento próprio para o ranking do termômetro variar.
 */
function curvaBase(atras: number): number {
  if (atras > 28) return 38;
  if (atras > 24) return 38 + (28 - atras) * 8; // subida rápida: a crise
  if (atras > 18) return 70; // platô do pico
  if (atras > 12) return 70 - (18 - atras) * 5; // alívio
  return Math.max(26, 40 - (12 - atras)); // queda suave até a última leitura
}

const TEMAS_DEMO: { tema: string; desloca: number; volume: number }[] = [
  { tema: "transporte", desloca: 12, volume: 9 },
  { tema: "saude", desloca: 4, volume: 7 },
  { tema: "saneamento", desloca: -2, volume: 5 },
  { tema: "comunicacao", desloca: -10, volume: 4 },
  { tema: "cultura_eventos", desloca: -18, volume: 6 },
  { tema: "educacao", desloca: -24, volume: 3 },
];

const THEMES: DailyTheme[] = [];
for (let atras = 34; atras >= 0; atras--) {
  const base = curvaBase(atras);
  for (const t of TEMAS_DEMO) {
    const pctNeg = Math.min(92, Math.max(4, base + t.desloca));
    const pctPos = Math.min(90, Math.max(4, 55 - Math.round(pctNeg / 2)));
    THEMES.push({
      dia: diaISO(atras),
      tema: t.tema,
      volume_posts: t.volume + ((atras * 7 + t.desloca) % 3),
      volume_coments: 18 + ((atras * 5 + t.volume) % 14),
      curtidas: 40,
      pct_pos: pctPos,
      pct_neg: pctNeg,
      pct_neu: Math.max(0, 100 - pctNeg - pctPos),
      score_risco: Math.round(pctNeg * 0.8),
    });
  }
}

const SUBTEMAS: SubtemaStat[] = [
  { tema: "transporte", subtema: "linha_de_onibus", total: 46, neg: 38, pctNeg: 83 },
  { tema: "transporte", subtema: "ponto_de_onibus", total: 21, neg: 14, pctNeg: 67 },
  { tema: "saude", subtema: "fila_de_atendimento", total: 33, neg: 24, pctNeg: 73 },
  { tema: "saude", subtema: "falta_de_medicamento", total: 18, neg: 12, pctNeg: 67 },
  { tema: "cultura_eventos", subtema: "sao_joao", total: 27, neg: 6, pctNeg: 22 },
];

const COMENTARIOS: ComentarioTema[] = [
  {
    texto: "Tiraram a linha do meu bairro sem avisar ninguém, e agora, como a gente vai trabalhar?",
    autor: "morador.alg",
    curtidas: 34,
    sentimento: "negativo",
    tema: "transporte",
    subtema: "linha_de_onibus",
    urlPost: "https://instagram.com/p/demo1",
  },
];

function cliente(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });
  qc.setQueryData(["daily-themes"], THEMES);
  qc.setQueryData(["subtemas"], SUBTEMAS);
  qc.setQueryData(["comentarios-tema"], COMENTARIOS);
  return qc;
}

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={cliente()}>
    <AuthProvider>
      <TemasPage />
    </AuthProvider>
  </QueryClientProvider>
);
