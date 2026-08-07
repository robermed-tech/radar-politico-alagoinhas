// Harness da Divisão da Conversa (sov-dev.html).
//
// Não entra no bundle: entrada Vite separada, mesmo padrão do dev-clima.tsx.
// Renderiza a SovPage REAL com o cache do react-query pré-populado (["radar"]
// e ["admin-sources"]), sem login e sem rede. Três cenários:
//
//   A) proporções da base real de 07/08 (imprensa 42 / gestão 29 / oposição 29,
//      com a oposição gerando mais conversa por post) — é o caso de produção;
//   B) lado sem votos suficientes — a reação negativa tem que dizer "sem
//      sinal", nunca exibir um percentual calculado sobre 3 votos;
//   C) período vazio — estado próprio, sem tela em branco.
//
// Rodar: npm run dev e abrir /sov-dev.html (?tema=light alterna o tema).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SovPage } from "./pages/SovPage";
import type { Post } from "./lib/data";
import type { Source } from "./lib/admin";
import "./index.css";

function hoje(desloca = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - desloca);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function post(over: Partial<Post>): Post {
  return {
    url: `https://instagram.com/p/${Math.random().toString(36).slice(2)}`,
    data_post: hoje(),
    autor: "prefeituraalagoinhas",
    categoria: "Prefeitura",
    caption: "",
    curtidas: 100,
    comentarios_total: 0,
    total_cidadaos: 0,
    total_politicos: 0,
    sentimento_post: "neutro",
    tom_publicacao: "neutro",
    confianca_tom: 80,
    sentimento_comentarios: "neutro",
    comentarios_pct_pos: 0,
    comentarios_pct_neg: 0,
    score_imagem: 50,
    score_risco: 10,
    risco_crise: "baixo",
    tema: "comunicacao",
    atribuicao: "",
    tendencia: "estavel",
    ...over,
  } as Post;
}

const FONTES: Source[] = [
  { id: 1, tenant_id: "alagoinhas", platform: "instagram", handle: "prefeituraalagoinhas", categoria: "Prefeitura", filtro: "governo", active: true },
  { id: 2, tenant_id: "alagoinhas", platform: "instagram", handle: "gustavoascarmo", categoria: "Prefeito", filtro: "governo", active: true },
  { id: 3, tenant_id: "alagoinhas", platform: "instagram", handle: "soulucianoalmeida", categoria: "Vereador", filtro: "oposicao", active: true },
  { id: 4, tenant_id: "alagoinhas", platform: "instagram", handle: "jaldicenunes", categoria: "Vereador", filtro: "oposicao", active: true },
  { id: 5, tenant_id: "alagoinhas", platform: "instagram", handle: "alagonews", categoria: "Portal", filtro: "imprensa", active: true },
  { id: 6, tenant_id: "alagoinhas", platform: "instagram", handle: "seligaalagoinhas", categoria: "Portal", filtro: "imprensa", active: true },
];

// A) Proporções da base real: oposição fala menos e gera mais por post;
//    posts espalhados por 5 semanas para a evolução ter curva.
const REAL: Post[] = [
  // semana atual — gestão bem avaliada nos próprios posts, voz menor
  post({ autor: "gustavoascarmo", comentarios_total: 120, comentarios_pct_pos: 55, comentarios_pct_neg: 18 }),
  post({ autor: "prefeituraalagoinhas", comentarios_total: 60, comentarios_pct_pos: 12, comentarios_pct_neg: 55, data_post: hoje(1) }),
  post({ autor: "soulucianoalmeida", categoria: "Oposição", comentarios_total: 170, comentarios_pct_pos: 4, comentarios_pct_neg: 60, data_post: hoje(1) }),
  post({ autor: "jaldicenunes", categoria: "Oposição", comentarios_total: 90, comentarios_pct_pos: 5, comentarios_pct_neg: 52, data_post: hoje(2) }),
  post({ autor: "alagonews", categoria: "Imprensa", comentarios_total: 80, comentarios_pct_pos: 8, comentarios_pct_neg: 45, data_post: hoje(2) }),
  post({ autor: "seligaalagoinhas", categoria: "Imprensa", comentarios_total: 150, comentarios_pct_pos: 6, comentarios_pct_neg: 56, data_post: hoje(3) }),
  post({ autor: "seligaalagoinhas", categoria: "Imprensa", comentarios_total: 110, comentarios_pct_pos: 10, comentarios_pct_neg: 40, data_post: hoje(4) }),
  // semanas anteriores — gestão dominava (a queda precisa aparecer na evolução)
  post({ autor: "gustavoascarmo", comentarios_total: 300, comentarios_pct_pos: 60, comentarios_pct_neg: 12, data_post: hoje(9) }),
  post({ autor: "prefeituraalagoinhas", comentarios_total: 210, comentarios_pct_pos: 30, comentarios_pct_neg: 30, data_post: hoje(10) }),
  post({ autor: "alagonews", categoria: "Imprensa", comentarios_total: 70, comentarios_pct_pos: 5, comentarios_pct_neg: 50, data_post: hoje(11) }),
  post({ autor: "soulucianoalmeida", categoria: "Oposição", comentarios_total: 90, comentarios_pct_pos: 3, comentarios_pct_neg: 58, data_post: hoje(12) }),
  post({ autor: "gustavoascarmo", comentarios_total: 260, comentarios_pct_pos: 62, comentarios_pct_neg: 10, data_post: hoje(16) }),
  post({ autor: "seligaalagoinhas", categoria: "Imprensa", comentarios_total: 60, comentarios_pct_pos: 8, comentarios_pct_neg: 42, data_post: hoje(17) }),
  post({ autor: "soulucianoalmeida", categoria: "Oposição", comentarios_total: 120, comentarios_pct_pos: 4, comentarios_pct_neg: 55, data_post: hoje(23) }),
  post({ autor: "prefeituraalagoinhas", comentarios_total: 240, comentarios_pct_pos: 40, comentarios_pct_neg: 22, data_post: hoje(24) }),
  post({ autor: "alagonews", categoria: "Imprensa", comentarios_total: 90, comentarios_pct_pos: 6, comentarios_pct_neg: 48, data_post: hoje(30) }),
  post({ autor: "gustavoascarmo", comentarios_total: 350, comentarios_pct_pos: 58, comentarios_pct_neg: 14, data_post: hoje(31) }),
];

// B) Lado com pouquíssimos votos: oposição com 1 post e 6 comentários, nenhum
//    voto suficiente — "sem sinal" no lugar do percentual.
const POUCOS_VOTOS: Post[] = [
  post({ autor: "gustavoascarmo", comentarios_total: 80, comentarios_pct_pos: 50, comentarios_pct_neg: 20 }),
  post({ autor: "soulucianoalmeida", categoria: "Oposição", comentarios_total: 6, comentarios_pct_pos: 17, comentarios_pct_neg: 33, data_post: hoje(1) }),
  post({ autor: "alagonews", categoria: "Imprensa", comentarios_total: 40, comentarios_pct_pos: 10, comentarios_pct_neg: 50, data_post: hoje(2) }),
];

function clientePara(posts: Post[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  qc.setQueryData(["radar"], { data: posts, perfis: [], source: "supabase" });
  qc.setQueryData(["admin-sources"], FONTES);
  return qc;
}

function Cenario({ titulo, nota, posts }: { titulo: string; nota: string; posts: Post[] }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ padding: "10px 20px", font: "700 15px/1.4 system-ui", background: "#111", color: "#fff" }}>
        {titulo}
        <div style={{ font: "400 13px/1.5 system-ui", opacity: 0.75, marginTop: 2 }}>{nota}</div>
      </div>
      <QueryClientProvider client={clientePara(posts)}>
        <SovPage />
      </QueryClientProvider>
    </section>
  );
}

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(
  <>
    <Cenario
      titulo="A) Proporções da base real"
      nota="Oposição gera mais conversa por post; a evolução mostra a gestão perdendo fatia; quadrante em 'Invisível'."
      posts={REAL}
    />
    <Cenario
      titulo="B) Lado sem votos suficientes"
      nota="A oposição tem 6 comentários e menos de 10 votos: a reação precisa dizer 'sem sinal', nunca um percentual."
      posts={POUCOS_VOTOS}
    />
    <Cenario
      titulo="C) Período vazio"
      nota="Sem posts na janela: estado vazio próprio, sem tela em branco."
      posts={[]}
    />
  </>
);
