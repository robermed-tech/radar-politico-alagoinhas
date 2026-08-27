// Harness de desenvolvimento do estado "sem sinal" do IAD (clima-dev.html).
//
// Não entra no bundle do app: é uma entrada Vite separada, no mesmo padrão do
// dev-icones.tsx. Renderiza a ClimaPage REAL (não uma réplica) com o cache do
// react-query pré-populado, então dá para ver os dois estados do hero lado a
// lado sem login e sem rede:
//
//   A) SEM SINAL  — posts com comentários, nenhum classificado (o caso em que
//                   o IAD converge para 50 e a tela afirmava "50% de aprovação"
//                   com o clima "Nublado, opiniões divididas" ao lado).
//   B) COM SINAL  — a mesma tela quando houve medição de verdade.
//
// Rodar: npm run dev e abrir /clima-dev.html (?tema=light alterna o tema).
// Exige o .env do projeto preenchido, com qualquer valor: o createClient do
// supabase-js lança se a URL vier vazia. Nenhuma chamada de rede é feita.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./components/AuthProvider";
import { ClimaPage } from "./pages/ClimaPage";
import type { Post, Briefing } from "./lib/data";
import "./index.css";

/** Hoje em dd/mm/yyyy: os posts precisam cair na janela de 24h, que é o padrão. */
function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function post(over: Partial<Post>): Post {
  const base = {
    url: `https://instagram.com/p/${Math.random().toString(36).slice(2)}`,
    data_post: hoje(),
    autor: "prefeituraalagoinhas",
    categoria: "Prefeitura",
    caption: "Publicação de exemplo do harness",
    curtidas: 120,
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
  } as Post;
  return { ...base, ...over };
}

// A) Comentários existem, nenhum foi classificado: 0 votos.
const SEM_SINAL: Post[] = [
  post({ comentarios_total: 30, autor: "prefeituraalagoinhas" }),
  post({ comentarios_total: 12, autor: "alagonews", categoria: "Imprensa" }),
  post({ comentarios_total: 8, autor: "gustavoascarmo", categoria: "Prefeito" }),
];

// B) Medição real: 206 votos (a mesma proporção da base em 29/07).
const COM_SINAL: Post[] = [
  post({ comentarios_total: 200, comentarios_pct_pos: 30, comentarios_pct_neg: 45, sentimento_post: "negativo" }),
  post({ comentarios_total: 80, comentarios_pct_pos: 20, comentarios_pct_neg: 50, autor: "alagonews", categoria: "Imprensa", sentimento_post: "negativo" }),
];

// C) Fronteira: exatamente 9 votos, um abaixo do piso de 10.
const FRONTEIRA: Post[] = [post({ comentarios_total: 100, comentarios_pct_pos: 5, comentarios_pct_neg: 4 })];

// D) Mesa de comando (modelo Viratempo, 21/08): IAD baixo o bastante para o
// hero cair em "Chuva" (o céu adaptativo tonaliza a atmosfera do card) e
// briefing presente, para o diagnóstico e os temas sentarem lado a lado na
// grade bento do xl, com o carimbo "análise gerada pela IA".
const CHUVA: Post[] = [
  post({ comentarios_total: 220, comentarios_pct_pos: 14, comentarios_pct_neg: 58, sentimento_post: "negativo", tema: "transporte" }),
  post({ comentarios_total: 90, comentarios_pct_pos: 20, comentarios_pct_neg: 50, autor: "alagonews", categoria: "Imprensa", sentimento_post: "negativo" }),
];
const BRIEFING_DEMO: Briefing = {
  dia: new Date().toISOString().slice(0, 10),
  periodo: "dia",
  nivel_crise: "alto",
  risco: 62,
  diagnostico:
    "A conversa do dia concentra críticas no transporte coletivo depois da mudança de linhas; elogios pontuais à pavimentação seguram o clima longe do extremo.",
  oportunidades: [],
  alertas: [
    { nivel: "alto", tema: "transporte coletivo", tema_categoria: "transporte" },
    { nivel: "moderado", tema: "iluminação pública", tema_categoria: "obras" },
  ],
  recomendacoes: [
    { canal: "Instagram", mensagem: "Reconhecer o problema e publicar o cronograma das novas linhas." },
  ],
  gerado_em: new Date().toISOString(),
};

/**
 * Comentários classificados sintéticos, presos à URL do primeiro post do
 * cenário — é o que faz o "Termômetro por tema" (GaugeTema) aparecer no
 * harness. As proporções cobrem a escala inteira: um tema 100% negativo, um
 * majoritariamente positivo e três intermediários, para o degradê e a cor do
 * valor serem conferíveis a olho. Antes esta query era semeada vazia e o
 * termômetro nunca renderizava aqui.
 */
function comentariosPara(posts: Post[]) {
  const urlPost = posts[0]?.url ?? "";
  const base = { texto: "comentário do harness", autor: "cidadao", curtidas: 0, subtema: "", urlPost };
  const temas: [string, number, number][] = [
    ["saneamento", 9, 0],   // 100% — vermelho cheio
    ["saude", 61, 14],      // 81%
    ["comunicacao", 47, 19],// 71% — fronteira do alerta
    ["obras", 11, 8],       // 58% — âmbar
    ["educacao", 8, 21],    // 28% — verde
  ];
  return temas.flatMap(([tema, neg, pos]) => [
    ...Array.from({ length: neg }, () => ({ ...base, tema, sentimento: "negativo" })),
    ...Array.from({ length: pos }, () => ({ ...base, tema, sentimento: "positivo" })),
  ]);
}

function clientePara(posts: Post[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });
  qc.setQueryData(["radar"], { data: posts, perfis: [], source: "supabase" });
  // As demais queries da página: pré-populadas com dado local para nenhuma
  // delas disparar rede (a URL do .env.local é falsa de propósito).
  qc.setQueryData(["comentarios-tema-todos"], comentariosPara(posts));
  for (const p of ["dia", "semana", "mes"]) {
    qc.setQueryData(["boletim", false, p], null);
    qc.setQueryData(["boletim", true, p], null);
    qc.setQueryData(["briefing", p], null);
  }
  return qc;
}

function Cenario({
  titulo,
  nota,
  posts,
  briefing,
}: {
  titulo: string;
  nota: string;
  posts: Post[];
  briefing?: Briefing;
}) {
  const qc = clientePara(posts);
  if (briefing) qc.setQueryData(["briefing", "dia"], briefing);
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
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ClimaPage />
        </AuthProvider>
      </QueryClientProvider>
    </section>
  );
}

// Quem aplica a classe de tema no <html> é o App.tsx, que o harness não usa.
// Sem isto a página renderiza sempre no mesmo tema e o hero "sem sinal" não
// seria conferido no claro, onde a tinta sobre a foto tem regra própria.
// Alterna com ?tema=light na URL.
const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(
  <>
    <Cenario
      titulo="A) SEM SINAL — 50 comentários, nenhum classificado (0 votos)"
      nota="Antes: 50% grande + 'Aprovação da gestão' + clima 'Nublado, opiniões divididas'. Agora: 'Sem sinal'."
      posts={SEM_SINAL}
    />
    <Cenario
      titulo="B) COM SINAL — 206 comentários classificados"
      nota="Nada muda: o número, o contador animado e o clima continuam como sempre."
      posts={COM_SINAL}
    />
    <Cenario
      titulo="C) FRONTEIRA — 9 votos, um abaixo do piso de 10"
      nota="Deve dizer 'Sem sinal' e informar quantos comentários foram classificados."
      posts={FRONTEIRA}
    />
    <Cenario
      titulo="D) MESA DE COMANDO — chuva, com briefing (modelo Viratempo de 21/08)"
      nota="Hero com a atmosfera tonalizada pela condição (foto continua); no xl o diagnóstico e os temas sentam lado a lado, com o carimbo 'análise gerada pela IA'."
      posts={CHUVA}
      briefing={BRIEFING_DEMO}
    />
  </>
);
