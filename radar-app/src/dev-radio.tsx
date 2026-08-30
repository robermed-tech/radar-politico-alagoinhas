// Harness do botão GRAVAR/PARAR da Rádio Escuta (radio-dev.html).
//
// Não entra no bundle do app: entrada Vite separada, no mesmo padrão do
// dev-clima.tsx e do dev-marca.tsx. Renderiza o card GravarAgora REAL (não uma
// réplica) com o cadastro de rádios no cache do react-query e a Edge Function
// `gravar-radio` interceptada — então dá para percorrer o ciclo inteiro sem
// login, sem admin e sem gastar um centavo de Apify:
//
// Traz também o player do clipe da citação com o MEDIDOR DE NÍVEL, alimentado
// por um WAV sintetizado aqui mesmo (fala simulada, com um estouro perto do
// fim para a zona âmbar e a retenção de pico aparecerem). O medidor lê o áudio
// de verdade pelo AnalyserNode, então o que se vê aqui é o que a tela mostra.
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
import { ClipeCitacao } from "./components/ClipeCitacao";
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

/**
 * WAV de teste: fala simulada (portadora grave com harmônicos, envelope
 * silábico) e um estouro perto do fim, para o medidor mostrar a zona âmbar e a
 * retenção de pico. Sintetizado no navegador — o harness não baixa nada.
 */
function wavDeTeste(segundos = 12, taxa = 22050): Blob {
  const n = segundos * taxa;
  const amostras = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / taxa;
    // Envelope silábico: sílabas de ~4/s, com pausas entre frases.
    const silaba = Math.max(0, Math.sin(2 * Math.PI * 3.7 * t)) ** 1.6;
    const estourando = t > 9 && t < 9.6;
    // O estouro ignora a pausa entre frases: sem isso ele cai num trecho mudo
    // e a zona âmbar nunca aparece (foi o que aconteceu na primeira versão).
    const frase = estourando || t % 5 < 3.4 ? 1 : 0.06;
    const env = Math.min(1, 0.34 * silaba * frase * (estourando ? 3.4 : 1));
    const voz =
      Math.sin(2 * Math.PI * 165 * t) * 0.6 +
      Math.sin(2 * Math.PI * 330 * t) * 0.25 +
      Math.sin(2 * Math.PI * 620 * t) * 0.15;
    amostras[i] = Math.max(-32768, Math.min(32767, voz * env * 32767));
  }
  const cabecalho = new ArrayBuffer(44);
  const v = new DataView(cabecalho);
  const texto = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) v.setUint8(pos + i, str.charCodeAt(i));
  };
  texto(0, "RIFF");
  v.setUint32(4, 36 + amostras.byteLength, true);
  texto(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // mono
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  texto(36, "data");
  v.setUint32(40, amostras.byteLength, true);
  return new Blob([cabecalho, amostras], { type: "audio/wav" });
}

const URL_DEMO = URL.createObjectURL(wavDeTeste());

// Dublê do Storage: `urlDoClipe` pede uma URL assinada do bucket privado, e
// aqui ela é o WAV sintetizado. Mesma razão do dublê de `functions` para
// trocar a propriedade inteira, não o método.
Object.defineProperty(supabase, "storage", {
  configurable: true,
  value: {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: URL_DEMO }, error: null }),
    }),
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

      <div
        style={{
          marginTop: 28, maxWidth: 560, padding: 20, borderRadius: 20,
          background: "var(--bg-1)", border: "1px solid var(--line)",
        }}
      >
        <p style={{ margin: 0, marginBottom: 4, fontWeight: 700, color: "var(--txt-1)" }}>
          Medidor de nível do clipe
        </p>
        <p style={{ margin: 0, marginBottom: 14, fontSize: 13, color: "var(--txt-2)" }}>
          Fala sintetizada de 12s, com um estouro aos 9s para ver a zona âmbar e a
          retenção de pico. O medidor lê o áudio pelo AnalyserNode: é medição, não animação.
        </p>
        <ClipeCitacao caminho="demo.wav" />
      </div>
    </div>
  );
}

const tema = new URLSearchParams(location.search).get("tema") === "light" ? "light" : "dark";
document.documentElement.className = tema === "light" ? "theme-light" : "theme-dark";

createRoot(document.getElementById("root")!).render(<Palco />);
