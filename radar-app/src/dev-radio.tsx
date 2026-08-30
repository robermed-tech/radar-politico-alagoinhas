// Harness do botão GRAVAR/PARAR da Rádio Escuta (radio-dev.html).
//
// Não entra no bundle do app: entrada Vite separada, no mesmo padrão do
// dev-clima.tsx e do dev-marca.tsx. Renderiza o card GravarAgora REAL (não uma
// réplica) com o cadastro de rádios no cache do react-query e a Edge Function
// `gravar-radio` interceptada — então dá para percorrer o ciclo inteiro sem
// login, sem admin e sem gastar um centavo de Apify:
//
//   ocioso      → o botão é a pílula teal "Gravar"
//   iniciando   → clicar em Gravar; o run ainda não apareceu na Apify
//   gravando    → o botão VIRA o medidor: avanço em teal + tempo que falta
//   sem duração → o INPUT do run não pôde ser lido; conta o tempo decorrido
//   indisponível→ falta APIFY_API_TOKEN: o painel não oferece PARAR
//
// O ciclo é de verdade: em "gravando", Parar abre a confirmação, aborta no
// dublê e o cenário volta para ocioso, como aconteceria na tela.
//
// Rodar: npm run dev e abrir /radio-dev.html (?tema=light alterna o tema).
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "./lib/auth";
import { GravarAgora } from "./components/GravarAgora";
import type { EstadoGravacao, RadioFonte } from "./lib/radio";
import "./index.css";

type Cenario = "ocioso" | "gravando" | "sem_duracao" | "indisponivel";

const RADIOS: RadioFonte[] = [
  {
    id: "r1", handle: "https://stream.example/atual", label: "Rádio Atual FM",
    active: true, config: { programas: [{ nome: "Debate da Manhã", hora_inicio: "07:00", duracao_min: 60 }] },
    created_at: new Date().toISOString(),
  },
  {
    id: "r2", handle: "https://stream.example/cidade", label: "Rádio Cidade",
    active: true, config: null, created_at: new Date().toISOString(),
  },
  {
    id: "r3", handle: "https://stream.example/boa", label: "Rádio Boa",
    active: false, config: null, created_at: new Date().toISOString(),
  },
];

/** Cenário corrente, lido pelo dublê da Edge Function. Global de propósito: a
 *  função interceptada não tem como saber de qual card veio a chamada, e o
 *  harness mostra um cenário por vez justamente por isso. */
let cenario: Cenario = "ocioso";
/** Início da captação simulada — o contador do botão conta a partir daqui. */
let desde = new Date().toISOString();

function estadoDoCenario(): EstadoGravacao {
  if (cenario === "indisponivel") return { gravando: false, runs: [], indisponivel: true };
  if (cenario === "ocioso") return { gravando: false, runs: [] };
  return {
    gravando: true,
    runs: [{
      id: "run_dublê",
      desde,
      // "sem_duracao" é o caso real de o INPUT do run não poder ser lido: o
      // medidor não inventa avanço e o botão passa a mostrar o decorrido.
      duracaoMin: cenario === "sem_duracao" ? null : 30,
      estacoes: cenario === "sem_duracao" ? [] : ["Rádio Atual FM"],
    }],
  };
}

// Dublê da Edge Function: nenhuma chamada sai do navegador.
//
// A troca é na PROPRIEDADE `functions` do cliente, não no método: no
// supabase-js v2 `functions` é um getter que devolve um FunctionsClient NOVO a
// cada acesso, então remendar `.invoke` na instância não vale para a chamada
// seguinte — o pedido vazava para a função real e voltava "Não autenticado".
Object.defineProperty(supabase, "functions", {
  configurable: true,
  value: {
    invoke: async (nome: string, opcoes?: { body?: { acao?: string } }) => {
      if (nome !== "gravar-radio") return { data: null, error: new Error(`sem dublê para ${nome}`) };
      const acao = opcoes?.body?.acao ?? "iniciar";
      if (acao === "estado") return { data: estadoDoCenario(), error: null };
      if (acao === "parar") {
        cenario = "ocioso";
        return { data: { ok: true, abortados: 1, jobsCancelados: 1 }, error: null };
      }
      // "iniciar": responde como o GitHub aceitando o disparo. O cenário SEGUE
      // ocioso de propósito — é assim que se vê o estado "Iniciando…", que
      // existe porque o run leva ~1 min para aparecer na Apify.
      return { data: { ok: true, estacoes: ["Rádio Atual FM"], duracao: 30 }, error: null };
    },
  },
});

function Palco() {
  const [atual, setAtual] = useState<Cenario>("ocioso");
  const [chave, setChave] = useState(0);

  function trocar(c: Cenario) {
    cenario = c;
    desde = new Date(Date.now() - 4 * 60 * 1000).toISOString(); // 4 min já gravados
    setAtual(c);
    setChave((k) => k + 1); // remonta o card e o QueryClient junto
  }

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["radios"], RADIOS);
  qc.setQueryData(["radio-gravacao"], estadoDoCenario());

  const CHIPS: Array<[Cenario, string]> = [
    ["ocioso", "Ocioso"],
    ["gravando", "Gravando (30 min)"],
    ["sem_duracao", "Gravando sem duração"],
    ["indisponivel", "Sem APIFY_API_TOKEN"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)", padding: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {CHIPS.map(([c, r]) => (
          <button
            key={c}
            onClick={() => trocar(c)}
            style={{
              borderRadius: 999, padding: "6px 14px", fontWeight: 700, fontSize: 14,
              background: atual === c ? "var(--brand)" : "transparent",
              color: atual === c ? "#04242F" : "var(--txt-2)",
              border: "1px solid var(--line)", cursor: "pointer",
            }}
          >
            {r}
          </button>
        ))}
      </div>
      <div style={{ maxWidth: 380 }}>
        <QueryClientProvider client={qc} key={chave}>
          <GravarAgora />
        </QueryClientProvider>
      </div>
    </div>
  );
}

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(<Palco />);
