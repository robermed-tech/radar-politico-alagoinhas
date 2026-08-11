// Harness do estado VAZIO da Análise do Clima (aprovacao-dev.html).
//
// Mesmo padrão do dev-clima.tsx: entrada Vite separada, fora do bundle, que
// renderiza a ApprovalPage REAL com o cache do react-query pré-populado, sem
// login e sem rede. Existe por causa do incidente de 11/08: com a coleta
// parada, a janela padrão de 7 dias fica vazia enquanto a de 30 dias tem
// posts — e o estado vazio não renderizava o PeriodoFilter, então o aviso
// mandava "ampliar no seletor acima" sem haver seletor nenhum na tela.
//
//   A) COLETA PARADA — posts só com ~20 dias de idade: abre vazia em 7 dias,
//      o seletor precisa estar lá, e clicar em "30 dias" mostra os dados.
//   B) BASE VAZIA    — nenhum post nem em 30 dias: a dica de ampliar some e
//      entra a frase de que nada foi coletado nos últimos 30 dias.
//
// Rodar: npm run dev e abrir /aprovacao-dev.html (?tema=light alterna o tema).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./components/AuthProvider";
import { ApprovalPage } from "./pages/ApprovalPage";
import type { Post } from "./lib/data";
import "./index.css";

/** Data com `idade` dias de atraso, em dd/mm/yyyy (formato da base). */
function diasAtras(idade: number): string {
  const d = new Date();
  d.setDate(d.getDate() - idade);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function post(over: Partial<Post>): Post {
  const base = {
    url: `https://instagram.com/p/${Math.random().toString(36).slice(2)}`,
    data_post: diasAtras(20),
    autor: "prefeituraalagoinhas",
    categoria: "Prefeitura",
    caption: "Publicação de exemplo do harness",
    curtidas: 120,
    comentarios_total: 40,
    total_cidadaos: 38,
    total_politicos: 2,
    sentimento_post: "neutro",
    tom_publicacao: "neutro",
    confianca_tom: 80,
    sentimento_comentarios: "misto",
    comentarios_pct_pos: 25,
    comentarios_pct_neg: 45,
    score_imagem: 50,
    score_risco: 10,
    risco_crise: "baixo",
    tema: "saude",
    atribuicao: "",
    tendencia: "estavel",
  } as Post;
  return { ...base, ...over };
}

// A) Coleta parada: tudo entre 14 e 25 dias atrás — 24h e 7d vazios, 30d cheio.
const COLETA_PARADA: Post[] = [
  post({ data_post: diasAtras(14) }),
  post({ data_post: diasAtras(16), autor: "alagonews", categoria: "Imprensa" }),
  post({ data_post: diasAtras(19), autor: "gustavoascarmo", categoria: "Prefeito" }),
  post({ data_post: diasAtras(22), tema: "obras" }),
  post({ data_post: diasAtras(25), autor: "soulucianoalmeida", categoria: "Oposição" }),
];

function clientePara(posts: Post[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });
  qc.setQueryData(["radar"], { data: posts, perfis: [], source: "supabase" });
  // As demais queries da página, vazias, para nada bater na rede.
  qc.setQueryData(["daily-metrics"], []);
  qc.setQueryData(["comments"], []);
  qc.setQueryData(["comentarios-tema"], []);
  return qc;
}

function Cenario({ titulo, nota, posts }: { titulo: string; nota: string; posts: Post[] }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div
        style={{
          padding: "10px 20px",
          font: "700 15px/1.4 system-ui, sans-serif",
          background: "#111",
          color: "#fff",
        }}
      >
        {titulo}
        <div style={{ font: "400 13px/1.5 system-ui, sans-serif", opacity: 0.75, marginTop: 2 }}>
          {nota}
        </div>
      </div>
      <QueryClientProvider client={clientePara(posts)}>
        <AuthProvider>
          <ApprovalPage />
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
      titulo="A) COLETA PARADA — posts só entre 14 e 25 dias atrás"
      nota="Abre vazia em 7 dias COM o seletor no topo; clicar em '30 dias' mostra os dados."
      posts={COLETA_PARADA}
    />
    <Cenario
      titulo="B) BASE VAZIA — nenhum post nem na janela de 30 dias"
      nota="Em 30 dias, a dica de ampliar dá lugar a 'Nenhuma publicação coletada nos últimos 30 dias'."
      posts={[]}
    />
  </>
);
