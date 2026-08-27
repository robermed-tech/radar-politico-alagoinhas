// Ferramenta de ajuste da MARCA e dos ELEMENTOS das páginas (marca-dev.html).
// Não entra no bundle: entrada Vite só de dev, mesmo padrão do icones-dev.
//
// Duas camadas de ajuste, na mesma tela:
// 1. MARCA — variante (wordmark/tique/nenhuma), altura, cor, alinhamento e
//    margens em cada superfície onde ela vive ou pode viver: sidebar, nav
//    mobile, Login (painel e logo compacta), Convite e banda do PDF. Clique
//    na própria logomarca dentro da réplica (ou no nome da superfície no
//    painel) para selecionar.
// 2. ELEMENTOS — todo texto e botão das réplicas é CLICÁVEL (pedido de
//    27/08): clique seleciona e o painel esquerdo abre texto, tamanho, peso,
//    cor e margens daquele elemento. A réplica do Login é a página INTEIRA
//    (painel de marca + formulário), não só a metade da marca.
//
// O resultado sai pelos botões de exportar, num JSON no espírito do
// painel-viratempo.json (o retrato de configuração que o Robério entregou em
// 27/08): `marcaPaginas` com a marca por superfície e `elementos` só com os
// ajustes feitos (o que não foi tocado não entra). A ferramenta NÃO escreve
// no app: ela é o mockup interativo do fluxo mockup-primeiro de sempre.
//
// Regras do produto que a ferramenta embute em vez de deixar violar:
// - a banda teal do PDF só aceita tinta escura #04242F (nunca branco sobre a
//   marca, regra auditada) — a cor daquela superfície fica travada;
// - logomarca é desenho (currentColor), então cor entra pelo CONTÊINER, nunca
//   pela classe .text-brand (que resolve por --brand-text).
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { WordmarkViratempo, TiqueViratempo } from "./components/LogoViratempo";
import "./index.css";

// ─── Modelo da marca ─────────────────────────────────────────────────────

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

// ─── Modelo dos elementos ────────────────────────────────────────────────

/** Ajuste de um elemento: só o que foi mexido entra (o resto herda o app). */
interface ElCfg {
  texto?: string;
  tamanho?: number;
  peso?: number;
  /** "marca" ou um hex; ausente = cor padrão do app. */
  cor?: string;
  margemTopo?: number;
  margemBaixo?: number;
  /** Só para BLOCOS das páginas internas: colunas (1 a 12) e visibilidade. */
  largura?: number;
  visivel?: boolean;
}

interface ElMeta {
  rotulo: string;
  /** Texto padrão do app (base do campo de texto). Vazio = texto não editável. */
  texto: string;
  tamanho: number;
  peso: number;
}

/** Registro dos elementos clicáveis, com os valores REAIS do app como padrão
 * (lembrando que neste painel text-sm = 16px e text-xs = 14px, o piso de
 * tipografia do tailwind.config). */
const ELEMENTOS: Record<string, ElMeta> = {
  "sidebar.menu": { rotulo: "Sidebar · itens do menu", texto: "", tamanho: 16, peso: 800 },
  "navMobile.chips": { rotulo: "Nav mobile · chips", texto: "", tamanho: 16, peso: 600 },
  "login.manchete": { rotulo: "Login · manchete", texto: "A opinião da cidade, em tempo real.", tamanho: 52, peso: 400 },
  "login.apoio": { rotulo: "Login · linha de apoio", texto: "Acompanhe o clima político, antecipe crises e saiba o que a população comenta.", tamanho: 18, peso: 400 },
  "login.feat1.titulo": { rotulo: "Login · feature 1 · título", texto: "Clima Político", tamanho: 16, peso: 700 },
  "login.feat1.desc": { rotulo: "Login · feature 1 · descrição", texto: "Termômetro visual da opinião pública", tamanho: 16, peso: 400 },
  "login.feat2.titulo": { rotulo: "Login · feature 2 · título", texto: "Alertas & Ações", tamanho: 16, peso: 700 },
  "login.feat2.desc": { rotulo: "Login · feature 2 · descrição", texto: "O que precisa de atenção hoje", tamanho: 16, peso: 400 },
  "login.feat3.titulo": { rotulo: "Login · feature 3 · título", texto: "O que o povo diz", tamanho: 16, peso: 700 },
  "login.feat3.desc": { rotulo: "Login · feature 3 · descrição", texto: "Vozes ouvidas nas redes, em tempo real", tamanho: 16, peso: 400 },
  "login.titulo": { rotulo: "Login · título do cartão", texto: "Entrar", tamanho: 30, peso: 800 },
  "login.subtitulo": { rotulo: "Login · subtítulo do cartão", texto: "Acesse com seu e-mail e senha institucionais.", tamanho: 16, peso: 400 },
  "login.labelEmail": { rotulo: "Login · rótulo do e-mail", texto: "Email", tamanho: 16, peso: 700 },
  "login.labelSenha": { rotulo: "Login · rótulo da senha", texto: "Senha", tamanho: 16, peso: 700 },
  "login.botao": { rotulo: "Login · botão entrar", texto: "Entrar", tamanho: 16, peso: 700 },
  "login.link": { rotulo: "Login · link de primeiro acesso", texto: "Primeiro acesso ou esqueci a senha", tamanho: 16, peso: 600 },
  "login.rodape": { rotulo: "Login · rodapé do cartão", texto: "Acesso restrito a usuários cadastrados", tamanho: 14, peso: 400 },
  "convite.titulo": { rotulo: "Convite · título", texto: "Bem-vindo(a) ao Viratempo", tamanho: 26, peso: 800 },
  "convite.subtitulo": { rotulo: "Convite · subtítulo", texto: "Defina sua senha para concluir o cadastro e continuar.", tamanho: 16, peso: 400 },
  "convite.labelSenha": { rotulo: "Convite · rótulo nova senha", texto: "Nova senha", tamanho: 16, peso: 700 },
  "convite.labelConfirmar": { rotulo: "Convite · rótulo confirmar", texto: "Confirmar senha", tamanho: 16, peso: 700 },
  "convite.botao": { rotulo: "Convite · botão", texto: "Definir senha e entrar", tamanho: 16, peso: 700 },
  "pdf.nome": { rotulo: "PDF · nome na banda", texto: "VIRATEMPO", tamanho: 19, peso: 800 },
};

// ─── Páginas internas (wireframes pelo retrato painel-viratempo.json) ────

interface KpiDef { id: string; rotulo: string; valor: string; sub: string }
interface BlocoDef { id: string; titulo: string; largura: number; visivel: boolean }
interface PaginaDef { id: string; titulo: string; kpis: KpiDef[]; blocos: BlocoDef[] }

/** As 10 telas de dados, transcritas do painel-viratempo.json (27/08) — só os
 * KPIs ativos; os valores são de EXEMPLO (na tela real o valor vem do dado).
 * Único desvio do JSON: "Alertas & Ações" leva o rótulo real do menu. */
const PAGINAS: PaginaDef[] = [
  {
    id: "estacao", titulo: "Estação Meteorológica",
    kpis: [
      { id: "iad", rotulo: "Aprovação", valor: "58%", sub: "Nos comentários do período" },
      { id: "coment", rotulo: "Comentários", valor: "1.284", sub: "Analisados nos últimos 7 dias" },
      { id: "posts", rotulo: "Publicações", valor: "96", sub: "Coletadas de 14 perfis" },
      { id: "alertas", rotulo: "Alertas", valor: "3", sub: "Planos de crise abertos" },
    ],
    blocos: [
      { id: "veredito", titulo: "Veredito do clima", largura: 6, visivel: true },
      { id: "radar", titulo: "Radar de coleta", largura: 3, visivel: true },
      { id: "engajamento", titulo: "Engajamento no período", largura: 3, visivel: true },
      { id: "diagnostico", titulo: "Diagnóstico da IA", largura: 12, visivel: true },
      { id: "temas", titulo: "Temas que merecem atenção", largura: 7, visivel: true },
      { id: "sugestoes", titulo: "Sugestões a serem avaliadas por especialista", largura: 5, visivel: true },
      { id: "termometro", titulo: "Termômetro de temas", largura: 12, visivel: true },
      { id: "divisao", titulo: "Divisão da conversa", largura: 12, visivel: false },
    ],
  },
  {
    id: "feed", titulo: "O que o povo diz",
    kpis: [
      { id: "coment", rotulo: "Comentários", valor: "1.284", sub: "No período escolhido" },
      { id: "criticos", rotulo: "Críticos", valor: "47%", sub: "Da conversa que toma partido" },
      { id: "favoraveis", rotulo: "Favoráveis", valor: "21%", sub: "Da conversa que toma partido" },
      { id: "neutros", rotulo: "Neutros", valor: "32%", sub: "Sem juízo sobre a gestão" },
    ],
    blocos: [
      { id: "feed-posts", titulo: "Publicações e reação", largura: 8, visivel: true },
      { id: "feed-citados", titulo: "Mais citados", largura: 4, visivel: true },
      { id: "feed-coment", titulo: "Comentários em destaque", largura: 12, visivel: true },
    ],
  },
  {
    id: "aprovacao", titulo: "Análise do Clima",
    kpis: [
      { id: "iad", rotulo: "Aprovação", valor: "58%", sub: "IAD do período" },
      { id: "votos", rotulo: "Tomam partido", valor: "812", sub: "Comentários com posição" },
      { id: "coment", rotulo: "Comentários", valor: "1.284", sub: "Analisados no período" },
      { id: "posts", rotulo: "Publicações", valor: "96", sub: "Na janela escolhida" },
    ],
    blocos: [
      { id: "apr-gauge", titulo: "Aprovação no período", largura: 5, visivel: true },
      { id: "apr-historico", titulo: "Histórico do IAD", largura: 7, visivel: true },
      { id: "apr-vozes", titulo: "Vozes da população", largura: 7, visivel: true },
      { id: "apr-relatorio", titulo: "Relatórios em PDF", largura: 5, visivel: true },
    ],
  },
  {
    id: "mapa", titulo: "Mapa da Cidade",
    kpis: [
      { id: "bairros", rotulo: "Bairros", valor: "12", sub: "Com menção no período" },
      { id: "mencoes", rotulo: "Menções", valor: "214", sub: "Comentários com localidade" },
      { id: "critico", rotulo: "Mais crítico", valor: "Centro", sub: "64% de reação negativa" },
      { id: "elogiado", rotulo: "Mais elogiado", valor: "Riacho", sub: "Creche entregue puxa elogios" },
    ],
    blocos: [
      { id: "mapa-rank", titulo: "Bairros por crítica", largura: 12, visivel: true },
      { id: "mapa-coment", titulo: "Comentários do bairro", largura: 12, visivel: false },
    ],
  },
  {
    id: "pedidos", titulo: "Pedidos do Povo",
    kpis: [
      { id: "pedidos", rotulo: "Pedidos", valor: "569", sub: "Registrados na base" },
      { id: "revisar", rotulo: "Revisar", valor: "14", sub: "Confiança abaixo de 60" },
      { id: "temas", rotulo: "Temas", valor: "8", sub: "Com pedido no período" },
      { id: "semana", rotulo: "Na semana", valor: "+37", sub: "Pedidos novos em 7 dias" },
    ],
    blocos: [
      { id: "ped-regua", titulo: "Temas por volume", largura: 5, visivel: true },
      { id: "ped-lista", titulo: "Pedidos", largura: 7, visivel: true },
    ],
  },
  {
    id: "perfil", titulo: "Análise por Perfil",
    kpis: [
      { id: "perfis", rotulo: "Perfis", valor: "14", sub: "Monitorados nas Fontes" },
      { id: "posts", rotulo: "Publicações", valor: "96", sub: "No período escolhido" },
      { id: "critica", rotulo: "Publica criticando", valor: "41%", sub: "Posts com tom crítico" },
      { id: "elogia", rotulo: "Publica elogiando", valor: "22%", sub: "Posts com tom favorável" },
    ],
    blocos: [
      { id: "per-chips", titulo: "Perfis monitorados", largura: 12, visivel: true },
      { id: "per-extremos", titulo: "Quem puxa a conversa", largura: 7, visivel: true },
      { id: "per-seguidores", titulo: "Ranking de seguidores", largura: 5, visivel: true },
    ],
  },
  {
    id: "previsoes", titulo: "Previsões",
    kpis: [
      { id: "subindo", rotulo: "Subindo", valor: "3", sub: "Temas ganhando crítica" },
      { id: "caindo", rotulo: "Caindo", valor: "2", sub: "Temas em alívio" },
      { id: "estaveis", rotulo: "Estabilizados", valor: "4", sub: "Sem movimento na semana" },
      { id: "alerta", rotulo: "Em alerta", valor: "1", sub: "Risco de virada para pior" },
    ],
    blocos: [
      { id: "prev-linha", titulo: "Trajetória do clima", largura: 12, visivel: true },
      { id: "prev-sobe", titulo: "Subindo e caindo", largura: 5, visivel: true },
      { id: "prev-termo", titulo: "Termômetro de temas", largura: 7, visivel: true },
    ],
  },
  {
    id: "alertas", titulo: "Alertas & Ações",
    kpis: [
      { id: "criticos", rotulo: "Críticos", valor: "1", sub: "Exigem ação imediata" },
      { id: "altos", rotulo: "Altos", valor: "2", sub: "Acompanhar de perto" },
      { id: "total", rotulo: "Total", valor: "3", sub: "Planos abertos na janela" },
      { id: "resolvidos", rotulo: "Resolvidos", valor: "5", sub: "Nos últimos 30 dias" },
    ],
    blocos: [{ id: "ale-planos", titulo: "Planos de crise", largura: 12, visivel: true }],
  },
  {
    id: "radio", titulo: "Rádio Escuta",
    kpis: [
      { id: "estacoes", rotulo: "Estações", valor: "4", sub: "Cadastradas no tenant" },
      { id: "captando", rotulo: "Captando", valor: "2", sub: "Gravaram na janela" },
      { id: "pautas", rotulo: "Pautas", valor: "6", sub: "Captadas hoje" },
      { id: "ouvinte", rotulo: "Voz de ouvinte", valor: "2", sub: "Trechos de cidadão no ar" },
    ],
    blocos: [
      { id: "rad-estacoes", titulo: "Rádios monitoradas", largura: 7, visivel: true },
      { id: "rad-gravar", titulo: "Gravar agora", largura: 5, visivel: true },
      { id: "rad-pautas", titulo: "Pautas captadas", largura: 12, visivel: true },
    ],
  },
  {
    id: "sov", titulo: "Divisão da Conversa",
    kpis: [
      { id: "gestao", rotulo: "Gestão", valor: "46%", sub: "Da conversa gerada" },
      { id: "oposicao", rotulo: "Oposição", valor: "33%", sub: "Da conversa gerada" },
      { id: "imprensa", rotulo: "Imprensa", valor: "21%", sub: "Da conversa gerada" },
      { id: "coment", rotulo: "Comentários", valor: "1.284", sub: "Base da divisão" },
    ],
    blocos: [
      { id: "sov-divisao", titulo: "Quem domina a conversa", largura: 12, visivel: true },
      { id: "sov-voz", titulo: "Voz por publicação", largura: 6, visivel: true },
      { id: "sov-rank", titulo: "Perfis que geram conversa", largura: 6, visivel: true },
    ],
  },
];

/** Largura/visibilidade padrão de cada bloco, para o painel e o export. */
const BLOCO_DEFAULTS: Record<string, { largura: number; visivel: boolean }> = {};

// Registra os elementos das páginas internas (título da página, KPIs e títulos
// de bloco), com os padrões reais do painel: H1 27/600, .section-label 15/700,
// número de KPI na display 34/800, legenda 14.
PAGINAS.forEach((p) => {
  ELEMENTOS[`pg.${p.id}.titulo`] = { rotulo: `${p.titulo} · título da página`, texto: p.titulo, tamanho: 27, peso: 600 };
  p.kpis.forEach((k) => {
    ELEMENTOS[`pg.${p.id}.kpi.${k.id}.rotulo`] = { rotulo: `${p.titulo} · KPI ${k.rotulo} · rótulo`, texto: k.rotulo, tamanho: 15, peso: 700 };
    ELEMENTOS[`pg.${p.id}.kpi.${k.id}.valor`] = { rotulo: `${p.titulo} · KPI ${k.rotulo} · valor`, texto: k.valor, tamanho: 34, peso: 800 };
    ELEMENTOS[`pg.${p.id}.kpi.${k.id}.sub`] = { rotulo: `${p.titulo} · KPI ${k.rotulo} · legenda`, texto: k.sub, tamanho: 14, peso: 400 };
  });
  p.blocos.forEach((b) => {
    ELEMENTOS[`pg.${p.id}.bloco.${b.id}`] = { rotulo: `${p.titulo} · bloco ${b.titulo}`, texto: b.titulo, tamanho: 15, peso: 700 };
    BLOCO_DEFAULTS[`pg.${p.id}.bloco.${b.id}`] = { largura: b.largura, visivel: b.visivel };
  });
});
ELEMENTOS["pg.periodo"] = { rotulo: "Páginas · seletor de período (24h/7d/30d)", texto: "", tamanho: 16, peso: 700 };

type ElOverrides = Record<string, ElCfg>;

// ─── Seleção e contexto ──────────────────────────────────────────────────

type Sel = { tipo: "marca"; id: SuperficieId } | { tipo: "el"; id: string };

interface CtxTipo {
  sel: Sel;
  setSel: (s: Sel) => void;
  cfgs: Cfgs;
  els: ElOverrides;
}

const Ctx = createContext<CtxTipo>(null as unknown as CtxTipo);

// ─── Persistência local (só conveniência de dev) ─────────────────────────

const CHAVE_LS = "dev-marca-cfg-v2";

function carregarEstado(): { cfgs: Cfgs; els: ElOverrides } {
  try {
    const bruto = localStorage.getItem(CHAVE_LS);
    if (!bruto) return { cfgs: PADRAO_APP, els: {} };
    const salvo = JSON.parse(bruto) as { cfgs?: Partial<Cfgs>; els?: ElOverrides };
    const cfgs = { ...PADRAO_APP };
    (Object.keys(cfgs) as SuperficieId[]).forEach((id) => {
      if (salvo.cfgs?.[id]) cfgs[id] = { ...cfgs[id], ...salvo.cfgs[id] };
    });
    return { cfgs, els: salvo.els ?? {} };
  } catch {
    return { cfgs: PADRAO_APP, els: {} };
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

// ─── Peças editáveis ─────────────────────────────────────────────────────

/** Envelopa um elemento da réplica: clique seleciona, ajustes sobrepõem. */
function Editavel({
  id,
  tag = "div",
  className = "",
  style,
  children,
}: {
  id: string;
  tag?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const { sel, setSel, els } = useContext(Ctx);
  const cfg = els[id] ?? {};
  const ativo = sel.tipo === "el" && sel.id === id;
  const Tag = tag;
  const st: CSSProperties = { ...style };
  if (cfg.tamanho != null) {
    st.fontSize = cfg.tamanho;
    st.lineHeight = 1.2;
  }
  if (cfg.peso != null) st.fontWeight = cfg.peso;
  if (cfg.cor) st.color = cfg.cor === "marca" ? "var(--brand)" : cfg.cor;
  if (cfg.margemTopo != null) st.marginTop = cfg.margemTopo;
  if (cfg.margemBaixo != null) st.marginBottom = cfg.margemBaixo;
  return (
    <Tag
      className={`editavel ${ativo ? "editavel-sel" : ""} ${className}`}
      style={st}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        setSel({ tipo: "el", id });
      }}
    >
      {cfg.texto ?? children}
    </Tag>
  );
}

/** A logomarca dentro da réplica. Clique seleciona a superfície. */
function MarcaSlot({ id }: { id: SuperficieId }) {
  const { sel, setSel, cfgs } = useContext(Ctx);
  const cfg = cfgs[id];
  const ativo = sel.tipo === "marca" && sel.id === id;
  const justify =
    cfg.alinhamento === "esquerda" ? "flex-start" : cfg.alinhamento === "centro" ? "center" : "flex-end";
  if (cfg.variante === "nenhuma") {
    // Alvo de clique mesmo sem marca, senão não há como propor uma.
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setSel({ tipo: "marca", id });
        }}
        className={`editavel ${ativo ? "editavel-sel" : ""} shrink-0 rounded border border-dashed border-line px-1.5 py-0.5 text-xs text-txt-3`}
      >
        sem marca
      </button>
    );
  }
  return (
    <div
      className={`editavel ${ativo ? "editavel-sel" : ""} flex shrink-0`}
      style={{
        justifyContent: justify,
        color: corResolvida(id, cfg),
        marginTop: cfg.margemTopo,
        marginBottom: cfg.margemBaixo,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setSel({ tipo: "marca", id });
      }}
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

function IconeStub({ claro = false }: { claro?: boolean }) {
  return (
    <span
      className={`h-4 w-4 shrink-0 rounded-md border-2 border-current ${claro ? "opacity-80" : "opacity-50"}`}
    />
  );
}

// ─── Réplicas ────────────────────────────────────────────────────────────

function SidebarReplica() {
  const itens = ["Estação Meteorológica", "Análise do Clima", "O que o povo diz", "Pedidos do Povo"];
  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r border-line bg-bg-1 p-3"
      style={{ boxShadow: "6px 0 28px -10px rgba(0,0,0,0.30)", minHeight: 380 }}
    >
      <div className="px-2">
        <MarcaSlot id="sidebar" />
      </div>
      <Editavel id="sidebar.menu" className="flex flex-col gap-1.5">
        {itens.map((rotulo, i) => (
          <span
            key={rotulo}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left tracking-wide ${i === 0 ? "" : "text-txt-2"}`}
            style={i === 0 ? PILULA_ATIVA : undefined}
          >
            <IconeStub />
            {rotulo}
          </span>
        ))}
      </Editavel>
    </aside>
  );
}

function NavMobileReplica() {
  const chips = ["Estação Meteorológica", "Análise do Clima", "O que o povo diz"];
  return (
    <div className="w-[375px] border border-line bg-bg-1">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <MarcaSlot id="navMobile" />
        <Editavel id="navMobile.chips" className="flex flex-1 gap-1 overflow-hidden">
          {chips.map((rotulo, i) => (
            <span
              key={rotulo}
              className={`shrink-0 rounded-lg px-3 py-1.5 ${i === 0 ? "" : "text-txt-2"}`}
              style={i === 0 ? PILULA_ATIVA : undefined}
            >
              {rotulo}
            </span>
          ))}
        </Editavel>
      </div>
      <div className="p-3 text-sm text-txt-3">conteúdo da página…</div>
    </div>
  );
}

const FEATURES_LOGIN = [
  { titulo: "login.feat1.titulo", desc: "login.feat1.desc" },
  { titulo: "login.feat2.titulo", desc: "login.feat2.desc" },
  { titulo: "login.feat3.titulo", desc: "login.feat3.desc" },
];

/** A página de Login INTEIRA (desktop): painel de marca + formulário. */
function LoginReplica() {
  return (
    <div
      className="grid w-full overflow-hidden rounded-[28px] border border-line"
      style={{ gridTemplateColumns: "1fr 1fr", maxWidth: 1000 }}
    >
      {/* painel de marca (petróleo chapado desde 27/08) */}
      <div className="flex flex-col p-10" style={{ background: "#04242F", color: "#FFFFFF", minHeight: 680 }}>
        <MarcaSlot id="loginPainel" />
        <div className="mt-auto">
          <Editavel
            id="login.manchete"
            tag="h1"
            className="max-w-md text-pretty text-[52px] font-normal leading-[1.05] tracking-tight"
          >
            {ELEMENTOS["login.manchete"].texto}
          </Editavel>
          <Editavel id="login.apoio" tag="p" className="mt-4 max-w-sm text-lg font-normal text-white/85">
            {ELEMENTOS["login.apoio"].texto}
          </Editavel>
          <div className="mt-8 space-y-3">
            {FEATURES_LOGIN.map((f) => (
              <div key={f.titulo} className="flex items-center gap-3 rounded-2xl bg-white/12 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
                  <IconeStub claro />
                </span>
                <div>
                  <Editavel id={f.titulo} className="text-base font-bold leading-tight">
                    {ELEMENTOS[f.titulo].texto}
                  </Editavel>
                  <Editavel id={f.desc} className="text-sm text-white/80">
                    {ELEMENTOS[f.desc].texto}
                  </Editavel>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* formulário */}
      <div className="grid place-items-center p-6" style={{ background: "var(--bg-page)" }}>
        <div className="w-full max-w-[440px]">
          <div className="rounded-[28px] border border-line bg-bg-1 p-8">
            <Editavel id="login.titulo" tag="h2" className="text-[30px] font-extrabold leading-tight tracking-tight">
              {ELEMENTOS["login.titulo"].texto}
            </Editavel>
            <Editavel id="login.subtitulo" tag="p" className="mt-1.5 text-base text-txt-2">
              {ELEMENTOS["login.subtitulo"].texto}
            </Editavel>
            <div className="mt-5 space-y-5">
              <div>
                <Editavel id="login.labelEmail" className="mb-1.5 text-sm font-bold uppercase tracking-wide text-txt-3">
                  {ELEMENTOS["login.labelEmail"].texto}
                </Editavel>
                <div className="h-12 w-full rounded-2xl border border-line bg-bg-2" />
              </div>
              <div>
                <Editavel id="login.labelSenha" className="mb-1.5 text-sm font-bold uppercase tracking-wide text-txt-3">
                  {ELEMENTOS["login.labelSenha"].texto}
                </Editavel>
                <div className="h-12 w-full rounded-2xl border border-line bg-bg-2" />
              </div>
              <Editavel
                id="login.botao"
                className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-bold text-white"
                style={{ background: "#04242F" }}
              >
                {ELEMENTOS["login.botao"].texto} →
              </Editavel>
            </div>
            <Editavel id="login.link" className="mt-4 w-full cursor-pointer text-center text-sm font-semibold text-brand">
              {ELEMENTOS["login.link"].texto}
            </Editavel>
            <Editavel id="login.rodape" tag="p" className="mt-4 text-center text-xs text-txt-3">
              {ELEMENTOS["login.rodape"].texto}
            </Editavel>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginCompactaReplica() {
  return (
    <div style={{ width: 384 }}>
      <MarcaSlot id="loginCompacta" />
      <div className="rounded-[28px] border border-line bg-bg-1 p-8">
        <div className="text-[26px] font-extrabold leading-tight tracking-tight">Entrar</div>
        <p className="mt-1.5 text-base text-txt-2">Visão do celular: a logo compacta senta acima do cartão.</p>
        <div className="mt-5 space-y-3">
          <div className="h-11 rounded-xl border border-line bg-bg-2" />
          <div className="h-11 rounded-xl border border-line bg-bg-2" />
        </div>
      </div>
    </div>
  );
}

function ConviteReplica() {
  return (
    <div style={{ width: 420 }}>
      <MarcaSlot id="convite" />
      <div className="rounded-[28px] border border-line bg-bg-1 p-8">
        <Editavel id="convite.titulo" tag="h2" className="text-[26px] font-extrabold leading-tight tracking-tight">
          {ELEMENTOS["convite.titulo"].texto}
        </Editavel>
        <Editavel id="convite.subtitulo" tag="p" className="mt-1.5 text-base text-txt-2">
          {ELEMENTOS["convite.subtitulo"].texto}
        </Editavel>
        <div className="mt-5 space-y-5">
          <div>
            <Editavel id="convite.labelSenha" className="mb-1.5 text-sm font-bold uppercase tracking-wide text-txt-3">
              {ELEMENTOS["convite.labelSenha"].texto}
            </Editavel>
            <div className="h-12 w-full rounded-2xl border border-line bg-bg-2" />
          </div>
          <div>
            <Editavel id="convite.labelConfirmar" className="mb-1.5 text-sm font-bold uppercase tracking-wide text-txt-3">
              {ELEMENTOS["convite.labelConfirmar"].texto}
            </Editavel>
            <div className="h-12 w-full rounded-2xl border border-line bg-bg-2" />
          </div>
          <Editavel
            id="convite.botao"
            className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-bold text-brand-ink"
            style={{ background: "var(--brand)", boxShadow: "0 8px 20px rgba(98,194,202,0.35)" }}
          >
            {ELEMENTOS["convite.botao"].texto} →
          </Editavel>
        </div>
      </div>
    </div>
  );
}

function PdfReplica() {
  const { cfgs } = useContext(Ctx);
  const cfg = cfgs.pdf;
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
        <MarcaSlot id="pdf" />
        {cfg.variante !== "wordmark" && (
          <Editavel id="pdf.nome" tag="span" style={{ fontWeight: 800, fontSize: 19, letterSpacing: 2 }}>
            {ELEMENTOS["pdf.nome"].texto}
          </Editavel>
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

/** Réplica do seletor de período compartilhado (PeriodoFilter). */
function PeriodoReplica() {
  return (
    <Editavel id="pg.periodo" className="flex shrink-0 items-center gap-1 rounded-xl border border-line bg-bg-1 p-1">
      {["24h", "7 dias", "30 dias"].map((rotulo, i) => (
        <span
          key={rotulo}
          className={`rounded-lg px-2.5 py-1 ${i === 1 ? "" : "text-txt-2"}`}
          style={i === 1 ? { background: "var(--brand)", color: "#04242F" } : undefined}
        >
          {rotulo}
        </span>
      ))}
    </Editavel>
  );
}

/** Wireframe de uma página interna: título + KPIs + blocos na grade de 12.
 * A disposição vem do retrato painel-viratempo.json; o conteúdo dos cards é
 * stub (na tela real quem preenche é o dado). */
function PaginaReplica({ pg }: { pg: PaginaDef }) {
  const { els } = useContext(Ctx);
  return (
    <div className="w-full space-y-4" style={{ maxWidth: 1060 }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Editavel
          id={`pg.${pg.id}.titulo`}
          tag="h1"
          className="text-[27px] font-semibold leading-tight tracking-tight"
        >
          {pg.titulo}
        </Editavel>
        <PeriodoReplica />
      </div>

      {pg.kpis.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          {pg.kpis.map((k) => (
            <div key={k.id} className="rounded-2xl border border-line bg-bg-1 p-4">
              <Editavel id={`pg.${pg.id}.kpi.${k.id}.rotulo`} className="section-label">
                {k.rotulo}
              </Editavel>
              <Editavel id={`pg.${pg.id}.kpi.${k.id}.valor`} className="mt-1 text-[34px] font-extrabold leading-none">
                {k.valor}
              </Editavel>
              <Editavel id={`pg.${pg.id}.kpi.${k.id}.sub`} className="mt-1.5 text-xs text-txt-3">
                {k.sub}
              </Editavel>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
        {pg.blocos.map((b) => {
          const idEl = `pg.${pg.id}.bloco.${b.id}`;
          const cfg = els[idEl] ?? {};
          const largura = Math.min(12, Math.max(1, cfg.largura ?? b.largura));
          const visivel = cfg.visivel ?? b.visivel;
          return (
            <div
              key={b.id}
              className={`rounded-2xl border bg-bg-1 p-4 ${visivel ? "border-line" : "border-dashed border-line opacity-50"}`}
              style={{ gridColumn: `span ${largura} / span ${largura}`, minHeight: 110 }}
            >
              <div className="flex items-center justify-between gap-2">
                <Editavel id={idEl} className="section-label">
                  {b.titulo}
                </Editavel>
                <span className="text-xs font-semibold text-txt-3">
                  {visivel ? `${largura}/12` : "oculto"}
                </span>
              </div>
              {visivel && (
                <div className="mt-3 space-y-2">
                  <div className="h-3 w-5/6 rounded bg-bg-2" />
                  <div className="h-3 w-2/3 rounded bg-bg-2" />
                </div>
              )}
            </div>
          );
        })}
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
  children: ReactNode;
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

function LinhaControle({ rotulo, children }: { rotulo: string; children: ReactNode }) {
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
  sufixo = "px",
}: {
  valor: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  sufixo?: string;
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
      <span className="w-12 text-right text-sm font-bold tabular-nums">{valor}{sufixo}</span>
    </div>
  );
}

// ─── App da ferramenta ───────────────────────────────────────────────────

function montarJson(cfgs: Cfgs, els: ElOverrides): string {
  const elementos: ElOverrides = {};
  Object.entries(els).forEach(([id, cfg]) => {
    if (Object.keys(cfg).length > 0) elementos[id] = cfg;
  });
  return JSON.stringify(
    { produto: "viratempo", ferramenta: "marca-dev", marcaPaginas: cfgs, elementos },
    null,
    2,
  );
}

const ESTILO_EDITAVEL = `
  .editavel { cursor: pointer; }
  .editavel:hover { outline: 1.5px dashed var(--brand); outline-offset: 2px; }
  .editavel-sel, .editavel-sel:hover { outline: 2px solid var(--brand); outline-offset: 2px; }
`;

function App() {
  const [estadoInicial] = useState(carregarEstado);
  const [cfgs, setCfgs] = useState<Cfgs>(estadoInicial.cfgs);
  const [els, setEls] = useState<ElOverrides>(estadoInicial.els);
  const [sel, setSel] = useState<Sel>({ tipo: "marca", id: "sidebar" });
  const [pagAtiva, setPagAtiva] = useState<string>("estacao");
  const [tema, setTema] = useState<"claro" | "escuro">("claro");
  const [avisoCopia, setAvisoCopia] = useState(false);

  useEffect(() => {
    document.documentElement.className = tema === "claro" ? "theme-light" : "theme-dark";
  }, [tema]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_LS, JSON.stringify({ cfgs, els }));
    } catch {
      /* conveniência de dev: sem storage, segue sem persistir */
    }
  }, [cfgs, els]);

  const mudaMarca = (id: SuperficieId, parcial: Partial<MarcaCfg>) =>
    setCfgs((c) => ({ ...c, [id]: { ...c[id], ...parcial } }));
  const mudaEl = (id: string, parcial: Partial<ElCfg>) =>
    setEls((e) => ({ ...e, [id]: { ...e[id], ...parcial } }));
  const limpaEl = (id: string) =>
    setEls((e) => {
      const copia = { ...e };
      delete copia[id];
      return copia;
    });

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(montarJson(cfgs, els));
      setAvisoCopia(true);
      setTimeout(() => setAvisoCopia(false), 1800);
    } catch {
      /* clipboard bloqueado: o JSON continua disponível no bloco abaixo */
    }
  };

  const baixar = () => {
    const blob = new Blob([montarJson(cfgs, els)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "marca-viratempo.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const restaurar = () => {
    setCfgs(PADRAO_APP);
    setEls({});
    try {
      localStorage.removeItem(CHAVE_LS);
    } catch {
      /* idem */
    }
  };

  // ── painel esquerdo conforme a seleção ──
  let painelSelecao: ReactNode;
  if (sel.tipo === "marca") {
    const meta = SUPERFICIES.find((s) => s.id === sel.id)!;
    const cfg = cfgs[sel.id];
    const muda = (parcial: Partial<MarcaCfg>) => mudaMarca(sel.id, parcial);
    painelSelecao = (
      <>
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
      </>
    );
  } else {
    const meta = ELEMENTOS[sel.id];
    const cfg = els[sel.id] ?? {};
    const muda = (parcial: Partial<ElCfg>) => mudaEl(sel.id, parcial);
    const pesoEfetivo = cfg.peso ?? meta.peso;
    const blocoDef = BLOCO_DEFAULTS[sel.id];
    painelSelecao = (
      <>
        <div className="text-sm font-bold text-txt-1">{meta.rotulo}</div>
        {blocoDef && (
          <>
            <LinhaControle rotulo="Largura (colunas de 12)">
              <Deslizante
                valor={cfg.largura ?? blocoDef.largura}
                min={1}
                max={12}
                sufixo=""
                onChange={(v) => muda({ largura: v })}
              />
            </LinhaControle>
            <LinhaControle rotulo="Visibilidade">
              <BotaoPilula ativo={(cfg.visivel ?? blocoDef.visivel) === true} onClick={() => muda({ visivel: true })}>
                visível
              </BotaoPilula>
              <BotaoPilula ativo={(cfg.visivel ?? blocoDef.visivel) === false} onClick={() => muda({ visivel: false })}>
                oculto
              </BotaoPilula>
            </LinhaControle>
          </>
        )}
        {meta.texto !== "" && (
          <LinhaControle rotulo="Texto">
            <textarea
              value={cfg.texto ?? meta.texto}
              onChange={(e) => muda({ texto: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-line bg-bg-2 p-2 text-sm"
            />
          </LinhaControle>
        )}
        <LinhaControle rotulo="Tamanho">
          <Deslizante valor={cfg.tamanho ?? meta.tamanho} min={10} max={96} onChange={(v) => muda({ tamanho: v })} />
        </LinhaControle>
        <LinhaControle rotulo="Peso">
          {[400, 500, 600, 700, 800].map((p) => (
            <BotaoPilula key={p} ativo={pesoEfetivo === p} onClick={() => muda({ peso: p })}>
              {p}
            </BotaoPilula>
          ))}
        </LinhaControle>
        <LinhaControle rotulo="Cor">
          <BotaoPilula ativo={cfg.cor == null} onClick={() => muda({ cor: undefined })}>padrão</BotaoPilula>
          <BotaoPilula ativo={cfg.cor === "marca"} onClick={() => muda({ cor: "marca" })}>marca</BotaoPilula>
          <BotaoPilula ativo={cfg.cor != null && cfg.cor !== "marca"} onClick={() => muda({ cor: "#62C2CA" })}>própria</BotaoPilula>
          {cfg.cor != null && cfg.cor !== "marca" && (
            <input
              type="color"
              value={cfg.cor}
              onChange={(e) => muda({ cor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent"
              aria-label="Cor própria do elemento"
            />
          )}
        </LinhaControle>
        <LinhaControle rotulo="Margem do topo">
          <Deslizante valor={cfg.margemTopo ?? 0} min={0} max={200} onChange={(v) => muda({ margemTopo: v })} />
        </LinhaControle>
        <LinhaControle rotulo="Margem de baixo">
          <Deslizante valor={cfg.margemBaixo ?? 0} min={0} max={200} onChange={(v) => muda({ margemBaixo: v })} />
        </LinhaControle>
        <button
          onClick={() => limpaEl(sel.id)}
          className="rounded-lg border border-line px-2.5 py-1 text-sm font-semibold text-txt-2"
        >
          limpar ajustes deste elemento
        </button>
      </>
    );
  }

  const ajustados = Object.entries(els).filter(([, c]) => Object.keys(c).length > 0);

  return (
    <Ctx.Provider value={{ sel, setSel, cfgs, els }}>
      <style>{ESTILO_EDITAVEL}</style>
      <div className="min-h-screen" style={{ background: "var(--bg-page)", color: "var(--txt1)" }}>
        {/* topo */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-bg-1 px-6 py-3">
          <div style={{ color: "var(--brand)" }}>
            <WordmarkViratempo altura={22} />
          </div>
          <div className="text-sm font-bold text-txt-2">marca e elementos · ferramenta de ajuste</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
              <div className="mb-1.5 text-sm font-bold text-txt-2">Marca por superfície</div>
              <div className="flex flex-col gap-1">
                {SUPERFICIES.map((s) => {
                  const ativa = sel.tipo === "marca" && sel.id === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSel({ tipo: "marca", id: s.id })}
                      className={`rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold ${ativa ? "" : "text-txt-2"}`}
                      style={ativa ? PILULA_ATIVA : undefined}
                    >
                      {s.rotulo}
                      <span className={`ml-1.5 text-xs font-semibold ${ativa ? "" : "text-txt-3"}`}>
                        {cfgs[s.id].variante === "nenhuma" ? "sem marca" : `${cfgs[s.id].variante} · ${cfgs[s.id].altura}px`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-line pt-3">{painelSelecao}</div>

            {ajustados.length > 0 && (
              <div className="border-t border-line pt-3">
                <div className="mb-1 text-sm font-bold text-txt-2">
                  {ajustados.length === 1 ? "1 elemento ajustado" : `${ajustados.length} elementos ajustados`}
                </div>
                <div className="flex flex-col gap-0.5">
                  {ajustados.map(([id]) => (
                    <button
                      key={id}
                      onClick={() => setSel({ tipo: "el", id })}
                      className="text-left text-xs font-semibold text-txt-3 hover:text-txt-1"
                    >
                      {ELEMENTOS[id]?.rotulo ?? id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="border-t border-line pt-3 text-xs text-txt-3">
              Clique em qualquer texto ou botão das réplicas para ajustar; clique na logomarca para ajustar a
              marca. Logomarca é isenta do AA de texto; a regra dura é a da banda teal do PDF: tinta escura,
              nunca branca. Os ajustes ficam salvos neste navegador; o JSON exportado é o que vira pedido de
              mudança.
            </p>

            <details>
              <summary className="cursor-pointer text-sm font-bold text-txt-2">Ver JSON</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-bg-2 p-2 text-xs leading-relaxed">
                {montarJson(cfgs, els)}
              </pre>
            </details>
          </aside>

          {/* réplicas */}
          <main className="flex min-w-0 flex-1 flex-col gap-8">
            <section>
              <div className="section-label mb-2 px-1">Sidebar (desktop)</div>
              <SidebarReplica />
            </section>

            <section>
              <div className="section-label mb-2 px-1">Nav mobile (topo)</div>
              <NavMobileReplica />
            </section>

            <section>
              <div className="section-label mb-2 px-1">Páginas internas do painel</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {PAGINAS.map((p) => (
                  <BotaoPilula key={p.id} ativo={p.id === pagAtiva} onClick={() => setPagAtiva(p.id)}>
                    {p.titulo}
                  </BotaoPilula>
                ))}
              </div>
              <PaginaReplica pg={PAGINAS.find((p) => p.id === pagAtiva)!} />
              <p className="mt-2 max-w-3xl text-xs text-txt-3">
                Wireframe pelo retrato painel-viratempo.json: título, indicadores e blocos na grade de 12
                colunas. Os valores dos indicadores são de exemplo (na tela real quem preenche é o dado);
                nos blocos dá para ajustar também largura e visibilidade.
              </p>
            </section>

            <section>
              <div className="section-label mb-2 px-1">Login · página inteira</div>
              <LoginReplica />
            </section>

            <div className="flex flex-wrap items-start gap-8">
              <section>
                <div className="section-label mb-2 px-1">Login · logo compacta (celular)</div>
                <LoginCompactaReplica />
              </section>

              <section>
                <div className="section-label mb-2 px-1">Aceitar Convite</div>
                <ConviteReplica />
              </section>
            </div>

            <section>
              <div className="section-label mb-2 px-1">PDF · banda do cabeçalho</div>
              <PdfReplica />
            </section>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
