// Ferramenta de ajuste da MARCA nas superfícies do painel (marca-dev.html).
// Não entra no bundle: entrada Vite só de dev, mesmo padrão do icones-dev.
//
// O que ela faz: renderiza réplicas reais (mesmas classes e medidas) dos seis
// lugares onde a marca vive ou pode viver — sidebar desktop, nav mobile,
// painel de marca do Login, logo compacta do Login, Aceitar Convite e a banda
// do PDF — e deixa ajustar ao vivo variante (wordmark/tique/nenhuma), altura,
// cor, alinhamento e margens de cada um. O resultado sai pelo botão de
// exportar, num JSON no espírito do painel-viratempo.json (o retrato de
// configuração que o Robério entregou em 27/08), para ser aplicado depois no
// código. A ferramenta NÃO escreve no app: ela é o mockup interativo do fluxo
// mockup-primeiro de sempre.
//
// Regras do produto que a ferramenta embute em vez de deixar violar:
// - a banda teal do PDF só aceita tinta escura #04242F (nunca branco sobre a
//   marca, regra auditada) — a cor daquela superfície fica travada;
// - logomarca é desenho (currentColor), então cor entra pelo CONTÊINER, nunca
//   pela classe .text-brand (que resolve por --brand-text).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WordmarkViratempo, TiqueViratempo } from "./components/LogoViratempo";
import "./index.css";

// ─── Modelo ──────────────────────────────────────────────────────────────

type Variante = "wordmark" | "tique" | "nenhuma";
type CorMarca = "marca" | "tinta" | "propria";
type Alinhamento = "esquerda" | "centro" | "direita";

interface MarcaCfg {
  variante: Variante;
  altura: number;
  cor: CorMarca;
  corPropria: string;
  alinhamento: Alinhamento;
  margemTopo: number;
  margemBaixo: number;
}

type SuperficieId =
  | "sidebar"
  | "navMobile"
  | "loginPainel"
  | "loginCompacta"
  | "convite"
  | "pdf";

type Cfgs = Record<SuperficieId, MarcaCfg>;

/** Estado REAL do app hoje (27/08). "Restaurar padrão do app" volta pra cá. */
const PADRAO_APP: Cfgs = {
  // App.tsx:268 — 30px em teal desde 27/08 (painel-viratempo.json).
  sidebar: { variante: "wordmark", altura: 30, cor: "marca", corPropria: "", alinhamento: "esquerda", margemTopo: 0, margemBaixo: 24 },
  // O topo mobile hoje NÃO tem marca (só os chips de navegação).
  navMobile: { variante: "nenhuma", altura: 22, cor: "tinta", corPropria: "", alinhamento: "esquerda", margemTopo: 0, margemBaixo: 0 },
  // LoginPage:125 — 68px em teal, 85px do topo (canvas de 27/08).
  loginPainel: { variante: "wordmark", altura: 68, cor: "marca", corPropria: "", alinhamento: "esquerda", margemTopo: 85, margemBaixo: 0 },
  // LoginPage:175 — logo compacta do mobile, tinta do tema, mb-8.
  loginCompacta: { variante: "wordmark", altura: 30, cor: "tinta", corPropria: "", alinhamento: "esquerda", margemTopo: 0, margemBaixo: 32 },
  // AceitarConvitePage:37 — igual à compacta.
  convite: { variante: "wordmark", altura: 30, cor: "tinta", corPropria: "", alinhamento: "esquerda", margemTopo: 0, margemBaixo: 32 },
  // relatorio.ts — tique de 30pt na banda, tinta escura travada.
  pdf: { variante: "tique", altura: 30, cor: "tinta", corPropria: "", alinhamento: "esquerda", margemTopo: 0, margemBaixo: 0 },
};

const SUPERFICIES: { id: SuperficieId; rotulo: string; nota: string; corTravada?: boolean; semMargens?: boolean }[] = [
  { id: "sidebar", rotulo: "Sidebar (desktop)", nota: "Barra lateral de 224px, todas as páginas." },
  { id: "navMobile", rotulo: "Nav mobile (topo)", nota: "Hoje sem marca; escolha uma variante para propor." },
  { id: "loginPainel", rotulo: "Login · painel de marca", nota: "Petróleo chapado; margem do topo é a descida da marca." },
  { id: "loginCompacta", rotulo: "Login · logo compacta", nota: "Aparece no celular, acima do cartão de entrar." },
  { id: "convite", rotulo: "Aceitar Convite", nota: "Acima do cartão de definir senha." },
  { id: "pdf", rotulo: "PDF · banda do cabeçalho", nota: "Tinta travada em #04242F: nunca branco sobre o teal.", corTravada: true, semMargens: true },
];

// ─── Persistência local (só conveniência de dev) ─────────────────────────

const CHAVE_LS = "dev-marca-cfg-v1";

function carregarCfgs(): Cfgs {
  try {
    const bruto = localStorage.getItem(CHAVE_LS);
    if (!bruto) return PADRAO_APP;
    const salvo = JSON.parse(bruto) as Partial<Cfgs>;
    const base = { ...PADRAO_APP };
    (Object.keys(base) as SuperficieId[]).forEach((id) => {
      if (salvo[id]) base[id] = { ...base[id], ...salvo[id] };
    });
    return base;
  } catch {
    return PADRAO_APP;
  }
}

// ─── Resolução de cor por superfície ─────────────────────────────────────

/** "Tinta do tema" muda de significado por superfície: nos cards claros é o
 * token do tema; no painel petróleo do Login é branco; na banda do PDF é o
 * #04242F auditado. */
function corResolvida(id: SuperficieId, cfg: MarcaCfg): string {
  if (id === "pdf") return "#04242F";
  if (cfg.cor === "marca") return "var(--brand)";
  if (cfg.cor === "propria") return cfg.corPropria || "var(--txt1)";
  return id === "loginPainel" ? "#FFFFFF" : "var(--txt1)";
}

// ─── Peças visuais ───────────────────────────────────────────────────────

function MarcaSlot({ cfg, cor }: { cfg: MarcaCfg; cor: string }) {
  if (cfg.variante === "nenhuma") return null;
  const justify =
    cfg.alinhamento === "esquerda" ? "flex-start" : cfg.alinhamento === "centro" ? "center" : "flex-end";
  return (
    <div
      className="flex shrink-0"
      style={{ justifyContent: justify, color: cor, marginTop: cfg.margemTopo, marginBottom: cfg.margemBaixo }}
    >
      {cfg.variante === "wordmark" ? (
        <WordmarkViratempo altura={cfg.altura} />
      ) : (
        <TiqueViratempo tamanho={cfg.altura} />
      )}
    </div>
  );
}

// Mesmo NAV_GLOW do App.tsx (pílula ativa do menu).
const PILULA_ATIVA = {
  background: "var(--brand)",
  boxShadow: "0 8px 22px -6px var(--brand-glow), inset 0 1px 0 rgba(255,255,255,0.28)",
  color: "#04242F",
} as const;

function IconeStub() {
  return <span className="h-4 w-4 shrink-0 rounded-md border-2 border-current opacity-50" />;
}

function SidebarReplica({ cfg }: { cfg: MarcaCfg }) {
  const itens = ["Estação Meteorológica", "Análise do Clima", "O que o povo diz", "Pedidos do Povo"];
  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r border-line bg-bg-1 p-3"
      style={{ boxShadow: "6px 0 28px -10px rgba(0,0,0,0.30)", minHeight: 380 }}
    >
      <div className="px-2">
        <MarcaSlot cfg={cfg} cor={corResolvida("sidebar", cfg)} />
      </div>
      <nav className="flex flex-col gap-1.5">
        {itens.map((rotulo, i) => (
          <span
            key={rotulo}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold tracking-wide ${i === 0 ? "" : "text-txt-2"}`}
            style={i === 0 ? PILULA_ATIVA : undefined}
          >
            <IconeStub />
            {rotulo}
          </span>
        ))}
      </nav>
    </aside>
  );
}

function NavMobileReplica({ cfg }: { cfg: MarcaCfg }) {
  const chips = ["Estação Meteorológica", "Análise do Clima", "O que o povo diz"];
  return (
    <div className="w-[375px] border border-line bg-bg-1">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <MarcaSlot cfg={cfg} cor={corResolvida("navMobile", cfg)} />
        <div className="flex flex-1 gap-1 overflow-hidden">
          {chips.map((rotulo, i) => (
            <span
              key={rotulo}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${i === 0 ? "" : "text-txt-2"}`}
              style={i === 0 ? PILULA_ATIVA : undefined}
            >
              {rotulo}
            </span>
          ))}
        </div>
      </div>
      <div className="p-3 text-sm text-txt-3">conteúdo da página…</div>
    </div>
  );
}

function LoginPainelReplica({ cfg }: { cfg: MarcaCfg }) {
  return (
    <div
      className="flex flex-col rounded-[28px] p-10"
      style={{ background: "#04242F", color: "#FFFFFF", width: 460, minHeight: 600 }}
    >
      <MarcaSlot cfg={cfg} cor={corResolvida("loginPainel", cfg)} />
      <div className="mt-auto">
        <h1 className="max-w-md text-pretty text-[52px] font-normal leading-[1.05] tracking-tight">
          A opinião da cidade, em tempo real.
        </h1>
        <p className="mt-4 max-w-sm text-lg font-normal text-white/85">
          Acompanhe o clima político, antecipe crises e saiba o que a população comenta.
        </p>
      </div>
    </div>
  );
}

function CartaoFormReplica({
  id,
  cfg,
  titulo,
  subtitulo,
  largura,
}: {
  id: SuperficieId;
  cfg: MarcaCfg;
  titulo: string;
  subtitulo: string;
  largura: number;
}) {
  return (
    <div style={{ width: largura }}>
      <MarcaSlot cfg={cfg} cor={corResolvida(id, cfg)} />
      <div className="rounded-[28px] border border-line bg-bg-1 p-8">
        <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">{titulo}</h2>
        <p className="mt-1.5 text-base text-txt-2">{subtitulo}</p>
        <div className="mt-5 space-y-3">
          <div className="h-11 rounded-xl border border-line bg-bg-2" />
          <div className="h-11 rounded-xl border border-line bg-bg-2" />
          <div className="grid h-11 place-items-center rounded-xl bg-brand text-sm font-bold text-brand-ink">
            Entrar
          </div>
        </div>
      </div>
    </div>
  );
}

function PdfReplica({ cfg }: { cfg: MarcaCfg }) {
  const justify =
    cfg.alinhamento === "esquerda" ? "flex-start" : cfg.alinhamento === "centro" ? "center" : "flex-end";
  return (
    <div className="overflow-hidden rounded-md border border-line" style={{ width: 595, background: "#FFFFFF" }}>
      <div style={{ height: 4.5, background: "#62C2CA" }} />
      <div
        className="flex items-center gap-3.5"
        style={{
          height: 84,
          background: "#62C2CA",
          borderBottom: "2px solid #3A9AA4",
          padding: "0 40px",
          justifyContent: justify,
          color: "#04242F",
        }}
      >
        {cfg.variante === "nenhuma" ? null : cfg.variante === "wordmark" ? (
          <WordmarkViratempo altura={cfg.altura} />
        ) : (
          <>
            <TiqueViratempo tamanho={cfg.altura} />
            <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: 2 }}>VIRATEMPO</span>
          </>
        )}
      </div>
      <div className="space-y-3 p-8">
        <div className="h-4 w-2/3 rounded" style={{ background: "#EDF3F4" }} />
        <div className="h-4 w-full rounded" style={{ background: "#EDF3F4" }} />
        <div className="h-4 w-5/6 rounded" style={{ background: "#EDF3F4" }} />
        <div className="text-xs" style={{ color: "#5B737D" }}>
          réplica visual da banda do relatório · o PDF real é desenhado por relatorio.ts
        </div>
      </div>
    </div>
  );
}

// ─── Controles ───────────────────────────────────────────────────────────

function BotaoPilula({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-sm font-semibold transition-colors ${ativo ? "" : "border border-line text-txt-2"}`}
      style={ativo ? PILULA_ATIVA : undefined}
    >
      {children}
    </button>
  );
}

function LinhaControle({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-bold text-txt-2">{rotulo}</div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Deslizante({
  valor,
  min,
  max,
  onChange,
}: {
  valor: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ accentColor: "var(--brand)" }}
      />
      <span className="w-12 text-right text-sm font-bold tabular-nums">{valor}px</span>
    </div>
  );
}

// ─── App da ferramenta ───────────────────────────────────────────────────

function montarJson(cfgs: Cfgs): string {
  return JSON.stringify(
    { produto: "viratempo", ferramenta: "marca-dev", marcaPaginas: cfgs },
    null,
    2,
  );
}

function App() {
  const [cfgs, setCfgs] = useState<Cfgs>(carregarCfgs);
  const [sel, setSel] = useState<SuperficieId>("sidebar");
  const [tema, setTema] = useState<"claro" | "escuro">("claro");
  const [avisoCopia, setAvisoCopia] = useState(false);

  useEffect(() => {
    document.documentElement.className = tema === "claro" ? "theme-light" : "theme-dark";
  }, [tema]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_LS, JSON.stringify(cfgs));
    } catch {
      /* conveniência de dev: sem storage, segue sem persistir */
    }
  }, [cfgs]);

  const meta = SUPERFICIES.find((s) => s.id === sel)!;
  const cfg = cfgs[sel];
  const muda = (parcial: Partial<MarcaCfg>) => setCfgs((c) => ({ ...c, [sel]: { ...c[sel], ...parcial } }));

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(montarJson(cfgs));
      setAvisoCopia(true);
      setTimeout(() => setAvisoCopia(false), 1800);
    } catch {
      /* clipboard bloqueado: o JSON continua disponível no bloco abaixo */
    }
  };

  const baixar = () => {
    const blob = new Blob([montarJson(cfgs)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "marca-viratempo.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const restaurar = () => {
    setCfgs(PADRAO_APP);
    try {
      localStorage.removeItem(CHAVE_LS);
    } catch {
      /* idem */
    }
  };

  const moldura = (id: SuperficieId) =>
    id === sel ? { boxShadow: "0 0 0 2px var(--bg-page), 0 0 0 4px var(--brand)", borderRadius: 16 } : undefined;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-page)", color: "var(--txt1)" }}>
      {/* topo */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-bg-1 px-6 py-3">
        <div style={{ color: "var(--brand)" }}>
          <WordmarkViratempo altura={22} />
        </div>
        <div className="text-sm font-bold text-txt-2">marca nas páginas · ferramenta de ajuste</div>
        <div className="ml-auto flex items-center gap-2">
          <BotaoPilula ativo={tema === "claro"} onClick={() => setTema("claro")}>tema claro</BotaoPilula>
          <BotaoPilula ativo={tema === "escuro"} onClick={() => setTema("escuro")}>tema escuro</BotaoPilula>
          <span className="mx-1 h-5 w-px bg-line" />
          <BotaoPilula ativo={false} onClick={restaurar}>restaurar padrão do app</BotaoPilula>
          <BotaoPilula ativo onClick={copiar}>{avisoCopia ? "copiado!" : "copiar JSON"}</BotaoPilula>
          <BotaoPilula ativo={false} onClick={baixar}>baixar JSON</BotaoPilula>
        </div>
      </div>

      <div className="flex items-start gap-6 p-6">
        {/* painel de controles */}
        <aside className="sticky top-6 w-[300px] shrink-0 space-y-4 rounded-2xl border border-line bg-bg-1 p-4">
          <div>
            <div className="mb-1.5 text-sm font-bold text-txt-2">Superfície</div>
            <div className="flex flex-col gap-1">
              {SUPERFICIES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSel(s.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold ${s.id === sel ? "" : "text-txt-2"}`}
                  style={s.id === sel ? PILULA_ATIVA : undefined}
                >
                  {s.rotulo}
                  <span className={`ml-1.5 text-xs font-semibold ${s.id === sel ? "" : "text-txt-3"}`}>
                    {cfgs[s.id].variante === "nenhuma" ? "sem marca" : `${cfgs[s.id].variante} · ${cfgs[s.id].altura}px`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm text-txt-3">{meta.nota}</p>

          <LinhaControle rotulo="Variante">
            <BotaoPilula ativo={cfg.variante === "wordmark"} onClick={() => muda({ variante: "wordmark" })}>wordmark</BotaoPilula>
            <BotaoPilula ativo={cfg.variante === "tique"} onClick={() => muda({ variante: "tique" })}>tique</BotaoPilula>
            <BotaoPilula ativo={cfg.variante === "nenhuma"} onClick={() => muda({ variante: "nenhuma" })}>nenhuma</BotaoPilula>
          </LinhaControle>

          <LinhaControle rotulo="Altura">
            <Deslizante valor={cfg.altura} min={12} max={120} onChange={(v) => muda({ altura: v })} />
          </LinhaControle>

          {!meta.corTravada && (
            <LinhaControle rotulo="Cor">
              <BotaoPilula ativo={cfg.cor === "marca"} onClick={() => muda({ cor: "marca" })}>marca</BotaoPilula>
              <BotaoPilula ativo={cfg.cor === "tinta"} onClick={() => muda({ cor: "tinta" })}>tinta do tema</BotaoPilula>
              <BotaoPilula ativo={cfg.cor === "propria"} onClick={() => muda({ cor: "propria" })}>própria</BotaoPilula>
              {cfg.cor === "propria" && (
                <input
                  type="color"
                  value={cfg.corPropria || "#62C2CA"}
                  onChange={(e) => muda({ corPropria: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent"
                  aria-label="Cor própria da marca"
                />
              )}
            </LinhaControle>
          )}

          <LinhaControle rotulo="Alinhamento">
            <BotaoPilula ativo={cfg.alinhamento === "esquerda"} onClick={() => muda({ alinhamento: "esquerda" })}>esquerda</BotaoPilula>
            <BotaoPilula ativo={cfg.alinhamento === "centro"} onClick={() => muda({ alinhamento: "centro" })}>centro</BotaoPilula>
            <BotaoPilula ativo={cfg.alinhamento === "direita"} onClick={() => muda({ alinhamento: "direita" })}>direita</BotaoPilula>
          </LinhaControle>

          {!meta.semMargens && (
            <>
              <LinhaControle rotulo="Margem do topo">
                <Deslizante valor={cfg.margemTopo} min={0} max={200} onChange={(v) => muda({ margemTopo: v })} />
              </LinhaControle>
              <LinhaControle rotulo="Margem de baixo">
                <Deslizante valor={cfg.margemBaixo} min={0} max={200} onChange={(v) => muda({ margemBaixo: v })} />
              </LinhaControle>
            </>
          )}

          <p className="border-t border-line pt-3 text-xs text-txt-3">
            Logomarca é isenta do AA de texto. A regra dura é a da banda teal do PDF: tinta escura, nunca branca.
            Os ajustes ficam salvos neste navegador; o JSON exportado é o que vira pedido de mudança.
          </p>

          <details>
            <summary className="cursor-pointer text-sm font-bold text-txt-2">Ver JSON</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-bg-2 p-2 text-xs leading-relaxed">
              {montarJson(cfgs)}
            </pre>
          </details>
        </aside>

        {/* réplicas */}
        <main className="flex min-w-0 flex-1 flex-col gap-8">
          <section onClick={() => setSel("sidebar")} className="cursor-pointer" style={moldura("sidebar")}>
            <div className="section-label mb-2 px-1">Sidebar (desktop)</div>
            <SidebarReplica cfg={cfgs.sidebar} />
          </section>

          <section onClick={() => setSel("navMobile")} className="cursor-pointer" style={moldura("navMobile")}>
            <div className="section-label mb-2 px-1">Nav mobile (topo)</div>
            <NavMobileReplica cfg={cfgs.navMobile} />
          </section>

          <section onClick={() => setSel("loginPainel")} className="cursor-pointer" style={moldura("loginPainel")}>
            <div className="section-label mb-2 px-1">Login · painel de marca</div>
            <LoginPainelReplica cfg={cfgs.loginPainel} />
          </section>

          <div className="flex flex-wrap items-start gap-8">
            <section onClick={() => setSel("loginCompacta")} className="cursor-pointer" style={moldura("loginCompacta")}>
              <div className="section-label mb-2 px-1">Login · logo compacta</div>
              <CartaoFormReplica
                id="loginCompacta"
                cfg={cfgs.loginCompacta}
                titulo="Entrar"
                subtitulo="Acesse com seu e-mail e senha institucionais."
                largura={384}
              />
            </section>

            <section onClick={() => setSel("convite")} className="cursor-pointer" style={moldura("convite")}>
              <div className="section-label mb-2 px-1">Aceitar Convite</div>
              <CartaoFormReplica
                id="convite"
                cfg={cfgs.convite}
                titulo="Bem-vindo(a) ao Viratempo"
                subtitulo="Defina sua senha para concluir o cadastro e continuar."
                largura={384}
              />
            </section>
          </div>

          <section onClick={() => setSel("pdf")} className="cursor-pointer" style={moldura("pdf")}>
            <div className="section-label mb-2 px-1">PDF · banda do cabeçalho</div>
            <PdfReplica cfg={cfgs.pdf} />
          </section>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
