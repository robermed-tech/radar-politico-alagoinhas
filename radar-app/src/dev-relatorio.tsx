// Harness de desenvolvimento do relatório do clima em PDF (relatorio-dev.html).
//
// Não entra no bundle do app: entrada Vite separada, no mesmo padrão do
// dev-clima.tsx e do dev-icones.tsx. Monta o card REAL (`RelatorioClima`) com
// posts e comentários sintéticos, sem login e sem rede — é onde se confere que
// o PDF abre, que os acentos saem certos e que a paginação fecha, sem depender
// do Supabase nem de uma sessão válida.
//
// Rodar: npm run dev e abrir /relatorio-dev.html (?tema=light alterna o tema).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RelatorioClima } from "./components/RelatorioClima";
import type { Comment, Post } from "./lib/data";
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
    ...over,
  } as Post;
}

// Temas com acento e cedilha de propósito: é o que o WinAnsiEncoding precisa
// entregar sem virar "?" no arquivo.
const POSTS: Post[] = [
  post({ tema: "saúde", comentarios_total: 320, comentarios_pct_pos: 12, comentarios_pct_neg: 71, autor: "soulucianoalmeida", categoria: "Oposição" }),
  post({ tema: "educação", comentarios_total: 180, comentarios_pct_pos: 44, comentarios_pct_neg: 26, data_post: hoje(2) }),
  post({ tema: "transporte", comentarios_total: 96, comentarios_pct_pos: 18, comentarios_pct_neg: 55, autor: "alagonews", categoria: "Imprensa", data_post: hoje(3) }),
  post({ tema: "obras", comentarios_total: 74, comentarios_pct_pos: 51, comentarios_pct_neg: 20, data_post: hoje(5) }),
  post({ tema: "segurança", comentarios_total: 42, comentarios_pct_pos: 33, comentarios_pct_neg: 38, autor: "jaldicenunes", categoria: "Oposição", data_post: hoje(6) }),
  post({ tema: "comunicação", comentarios_total: 21, comentarios_pct_pos: 60, comentarios_pct_neg: 10, data_post: hoje(20) }),
];

function comentario(over: Partial<Comment>): Comment {
  return {
    id: Math.random().toString(36).slice(2),
    url_post: POSTS[0].url,
    autor_post: "prefeituraalagoinhas",
    categoria_post: "Prefeitura",
    username: "cidada.alagoinhas",
    tipo: "cidadao",
    texto: "Exemplo de comentário do harness.",
    curtidas: 10,
    sentimento: "negativo",
    data_comentario: new Date().toISOString().slice(0, 10),
    confianca_tema: 85,
    ...over,
  } as Comment;
}

const COMENTARIOS: Comment[] = [
  comentario({
    texto: "A situação do posto de saúde do bairro é vergonhosa: fila desde às 4h da manhã e não tem médico. Precisamos de atenção urgente à saúde pública, não de vídeo bonito nas redes.",
    curtidas: 412, sentimento: "negativo", username: "maria.jose",
  }),
  comentario({
    texto: "Ônibus lotado, atrasado e caro. Quem depende do transporte público nessa cidade sabe que a promessa não saiu do papel.",
    curtidas: 208, sentimento: "negativo", username: "joao_alagoinhense", url_post: POSTS[2].url, autor_post: "alagonews",
  }),
  comentario({
    texto: "Já melhorou muito a coleta de lixo aqui na minha rua, mas a iluminação continua péssima.",
    curtidas: 87, sentimento: "negativo", username: "vizinha.doriacho",
  }),
  comentario({
    texto: "Parabéns pela creche entregue no bairro! Minha filha já está matriculada e a estrutura ficou ótima.",
    curtidas: 310, sentimento: "positivo", username: "familia.souza", url_post: POSTS[1].url,
  }),
  comentario({
    texto: "A reforma da praça ficou linda, dá gosto levar as crianças no fim de tarde. Continuem assim.",
    curtidas: 145, sentimento: "positivo", username: "seu.antonio", url_post: POSTS[3].url,
  }),
];

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});
// Briefing pré-populado nos três períodos: nenhuma consulta sai para a rede.
// O "dia" traz texto para conferir a seção da IA; "semana"/"mes" ficam nulos
// para conferir o relatório SEM briefing, que é o caso do dia sem crédito.
qc.setQueryData(["briefing", "dia"], {
  dia: new Date().toISOString().slice(0, 10),
  periodo: "dia",
  nivel_crise: "moderado",
  risco: 58,
  diagnostico:
    "A pressão das últimas horas se concentra na saúde: a fila do posto do bairro concentra a maior parte das críticas e já aparece associada à cobrança por presença médica. A entrega da creche segura a avaliação positiva, mas não compensa o volume da queixa em saúde.",
  oportunidades: [],
  alertas: [
    { nivel: "alto", tema: "saúde", tema_categoria: "saude" },
    { nivel: "médio", tema: "transporte", tema_categoria: "transporte" },
  ],
  recomendacoes: [
    { canal: "Instagram", mensagem: "Publicar a escala médica da semana no posto citado, com horário e nome do plantão." },
    { canal: "Rádio", mensagem: "Dar entrevista curta sobre o cronograma de reforço do transporte no horário de pico." },
  ],
  gerado_em: new Date().toISOString(),
});
qc.setQueryData(["briefing", "semana"], null);
qc.setQueryData(["briefing", "mes"], null);

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ font: "700 15px/1.4 system-ui", marginBottom: 12, color: "var(--txt1)" }}>
        Harness do relatório em PDF · 24h e 7 dias têm dados; 30 dias inclui um post antigo.
        O briefing só existe no período "24h" (os outros conferem o relatório sem análise da IA).
      </div>
      <RelatorioClima posts={POSTS} comentarios={COMENTARIOS} />
    </div>
  </QueryClientProvider>
);
