import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { AlertaConfig } from "@/components/AlertaConfig";
import {
  fetchSettings, saveSettings,
  fetchKeywords, addKeyword, toggleKeyword, deleteKeyword,
  fetchSources, addSource, toggleSource, deleteSource,
  fetchUsers, inviteUser, setUserRole, deleteUser,
  type ScoreWeights, type ClimateThresholds, type NotificationConfig,
} from "@/lib/admin";
import {
  fetchSources as fetchColetaSources, addSource as addColetaSource,
  toggleSource as toggleColetaSource, deleteSource as deleteColetaSource,
  normalizeHandle, type Platform, type Source as ColetaSource,
} from "@/lib/sources";
import {
  fetchCollectionLogsHoje, fetchFontesUnificadas,
  calcKpis, resumoPorRede, volumePorHora,
} from "@/lib/collection";
import { fetchServiceStatus } from "@/lib/data";
import { DEFAULT_NOTIFICATION } from "@/lib/settings";
import { type Role } from "@/lib/auth";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";
import { IconWarningTriangle } from "@/components/icons";
import { useOnlineUserIds } from "@/lib/presence";

type Tab =
  | "score" | "relevancia" | "fontes" | "fontes-coleta" | "monitor"
  | "usuarios" | "notificacoes" | "clima";

const TABS: { id: Tab; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "relevancia", label: "Relevância" },
  { id: "fontes", label: "Fontes" },
  { id: "fontes-coleta", label: "Fontes (coleta)" },
  { id: "monitor", label: "Monitor de coleta" },
  { id: "usuarios", label: "Usuários" },
  { id: "notificacoes", label: "Notificações" },
  { id: "clima", label: "Clima" },
];

// Banner simples de feedback (sucesso/erro).
function Feedback({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      className="rounded-lg px-3 py-2 text-xs font-semibold"
      style={
        msg.ok
          ? { background: "rgba(22,163,74,0.1)", color: "#16A34A" }
          : { background: "rgba(239,68,68,0.1)", color: "#EF4444" }
      }
    >
      {msg.text}
    </p>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-txt-3">{title}</div>
      {children}
    </div>
  );
}

/**
 * Uso de créditos Apify — sempre visível (antes só aparecia acima de 70% de
 * uso, então na prática nunca era visto: no consumo normal de Alagoinhas
 * fica em 0-5%/mês). Vira widget de acompanhamento contínuo, com o mesmo
 * alerta visual de antes só quando o uso fica alto.
 */
function ApifyStatusBanner() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["service-status-apify"],
    queryFn: () => fetchServiceStatus("apify"),
    staleTime: 5 * 60 * 1000,
    // apify-usage.yml atualiza o dado no banco a cada 30 min; refetch daqui
    // a cada 5 min mantém a tela em sincronia sem precisar de F5 manual.
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) return null;

  if (!status) {
    return (
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="text-sm font-bold text-txt-1">Créditos Apify</div>
        <div className="mt-0.5 text-xs text-txt-3">
          Sem leitura ainda — aparece aqui depois da próxima execução do ÁGORA.
        </div>
      </div>
    );
  }

  const pct = status.uso_pct;
  const critico = pct >= 90;
  const atencao = pct >= 70;
  const cor  = critico ? "#EF4444" : atencao ? "#F97316" : "#22C55E";
  const bg   = critico ? "rgba(239,68,68,0.08)" : atencao ? "rgba(249,115,22,0.08)" : "rgba(34,197,94,0.06)";
  const bord = critico ? "rgba(239,68,68,0.30)" : atencao ? "rgba(249,115,22,0.30)" : "rgba(34,197,94,0.22)";

  const atualizado = (() => {
    try { return new Date(status.atualizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  })();

  return (
    <div className="rounded-xl border p-4" style={{ background: bg, borderColor: bord }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color: cor }}>
            {atencao && <IconWarningTriangle size={16} />}
            {critico ? "Créditos Apify quase esgotados" : atencao ? "Créditos Apify em atenção" : "Créditos Apify"}
          </div>
          <div className="mt-0.5 text-xs text-txt-3">
            ${status.uso_usd.toFixed(2)} de ${status.teto_usd.toFixed(2)} consumidos · {pct.toFixed(0)}% do limite mensal
            {critico && " — coleta pode ser bloqueada a qualquer momento"}
          </div>
        </div>
        <div className="text-[11px] text-txt-3">Atualizado {atualizado}</div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, background: cor }}
        />
      </div>
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("score");

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Administração</h1>
        <p className="text-sm text-txt-2">Configuração do Radar Comando — acesso exclusivo de administradores</p>
      </div>
      <ApifyStatusBanner />

      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg-1 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.id ? "bg-brand text-white" : "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "score" && <ScoreSection />}
      {tab === "relevancia" && <KeywordsSection />}
      {tab === "fontes" && <SourcesSection />}
      {tab === "fontes-coleta" && <FontesColetaSection />}
      {tab === "monitor" && <ColetaMonitorSection />}
      {tab === "usuarios" && <UsersSection />}
      {tab === "notificacoes" && <NotificationsSection />}
      {tab === "clima" && <ClimateSection />}
    </div>
  );
}

// ── Score ────────────────────────────────────────────────────
const SCORE_FIELDS: { key: keyof ScoreWeights; label: string }[] = [
  { key: "risco_iad", label: "Peso: aprovação inversa (100 − IAD)" },
  { key: "risco_pct_alto", label: "Peso: % de posts com risco alto" },
  { key: "risco_velocidade", label: "Peso: velocidade do negativo" },
  { key: "risco_amplificacao", label: "Peso: amplificação negativa" },
  { key: "risco_ica", label: "Peso: confiança inversa (100 − ICA)" },
  { key: "iad_neutro", label: "Valor do comentário neutro no IAD" },
];

function ScoreSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: fetchSettings });
  const [draft, setDraft] = useState<ScoreWeights | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const weights = draft ?? data?.score_weights ?? null;

  if (!weights) return <div className="text-sm text-txt-2">Carregando…</div>;

  async function salvar() {
    const err = await saveSettings({ score_weights: weights! });
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: "✔ Pesos do score salvos" });
    qc.invalidateQueries({ queryKey: ["admin-settings"] });
  }

  return (
    <Card title="Pesos do score composto (risco)">
      <p className="mb-3 text-xs text-txt-3">
        Estes pesos alimentam, ao vivo, os cálculos de IAD e Risco exibidos no painel
        (o dashboard lê tenant_settings ao abrir). A soma dos pesos de risco idealmente
        fecha em 1.0. Obs.: o <span className="font-semibold">score_risco por post</span> vem do
        modelo de IA e não é afetado por estes pesos — eles governam os índices agregados do painel.
      </p>
      <div className="space-y-2">
        {SCORE_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 flex-1 text-txt-2">{f.label}</span>
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={weights[f.key]}
              onChange={(e) =>
                setDraft({ ...weights, [f.key]: parseFloat(e.target.value) || 0 })
              }
              className="w-24 rounded-lg border border-line bg-bg-2 px-3 py-1.5 text-right text-sm outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={salvar}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
        >
          Salvar pesos
        </button>
        <Feedback msg={msg} />
      </div>
    </Card>
  );
}

// ── Relevância (keywords) ────────────────────────────────────
function KeywordsSection() {
  const qc = useQueryClient();
  const { data: keywords } = useQuery({ queryKey: ["admin-keywords"], queryFn: fetchKeywords });
  const [novo, setNovo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-keywords"] });

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) refresh();
  }

  return (
    <Card title="Palavras-chave do filtro de relevância">
      <div className="flex gap-2">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && novo.trim()) { run(() => addKeyword(novo), "✔ Adicionada"); setNovo(""); } }}
          placeholder="Nova palavra-chave…"
          className="flex-1 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => { if (novo.trim()) { run(() => addKeyword(novo), "✔ Adicionada"); setNovo(""); } }}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
        >
          Adicionar
        </button>
      </div>
      <div className="my-3"><Feedback msg={msg} /></div>
      <div className="space-y-1.5">
        {(keywords ?? []).map((k) => (
          <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
            <span className={k.active ? "text-txt-1" : "text-txt-3 line-through"}>{k.keyword}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => run(() => toggleKeyword(k.id, !k.active), "✔ Atualizada")}
                className="text-xs font-semibold text-txt-3 hover:text-txt-1"
              >
                {k.active ? "Desativar" : "Ativar"}
              </button>
              <button
                onClick={() => run(() => deleteKeyword(k.id), "✔ Removida")}
                className="text-xs font-semibold text-risk-crit hover:underline"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {keywords?.length === 0 && <p className="text-sm text-txt-3">Nenhuma palavra-chave cadastrada.</p>}
      </div>
    </Card>
  );
}

const FILTRO_OPTS = [
  { value: "governo",  label: "Governo" },
  { value: "oposicao", label: "Oposição" },
  { value: "imprensa", label: "Imprensa" },
];

const FILTRO_BADGE: Record<string, string> = {
  governo:  "rgba(22,163,74,0.12)",
  oposicao: "rgba(239,68,68,0.12)",
  imprensa: "rgba(99,102,241,0.12)",
};
const FILTRO_COLOR: Record<string, string> = {
  governo:  "#16A34A",
  oposicao: "#EF4444",
  imprensa: "#6366F1",
};

// ── Fontes monitoradas ───────────────────────────────────────
function SourcesSection() {
  const qc = useQueryClient();
  const { data: sources } = useQuery({ queryKey: ["admin-sources"], queryFn: fetchSources });
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [categoria, setCategoria] = useState("");
  const [filtro, setFiltro] = useState("governo");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-sources"] });

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) refresh();
  }

  function adicionar() {
    if (!handle.trim()) return;
    run(() => addSource(platform, handle, categoria || handle.trim(), filtro), "✔ Adicionada");
    setHandle("");
    setCategoria("");
  }

  return (
    <Card title="Fontes monitoradas">
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="instagram">Instagram</option>
          <option value="facebook" disabled>Facebook (em breve)</option>
          <option value="tiktok" disabled>TikTok (em breve)</option>
          <option value="youtube" disabled>YouTube (em breve)</option>
          <option value="x" disabled>X / Twitter (em breve)</option>
        </select>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && adicionar()}
          placeholder="@perfil"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="Categoria (ex: Prefeito, Imprensa local…)"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {FILTRO_OPTS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-txt-3">
        Hoje só o Instagram é coletado de fato. Um perfil salvo aqui entra na próxima
        execução do ÁGORA automaticamente (o pipeline lê esta lista a cada rodada — não
        precisa reconfigurar nada na Apify manualmente).
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={adicionar}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
        >
          Adicionar
        </button>
        <Feedback msg={msg} />
      </div>
      <div className="mt-3 space-y-1.5">
        {(sources ?? []).map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: FILTRO_BADGE[s.filtro] ?? "rgba(100,100,100,0.1)", color: FILTRO_COLOR[s.filtro] ?? "#888" }}
              >
                {FILTRO_OPTS.find(o => o.value === s.filtro)?.label ?? s.filtro}
              </span>
              <span className={s.active ? "text-txt-1" : "text-txt-3 line-through"}>
                <span className="text-txt-3">{s.platform}/</span>{s.handle}
                {s.categoria && s.categoria !== s.handle && (
                  <span className="ml-1 text-txt-3">· {s.categoria}</span>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => run(() => toggleSource(s.id, !s.active), "✔ Atualizada")}
                className="text-xs font-semibold text-txt-3 hover:text-txt-1"
              >
                {s.active ? "Desativar" : "Ativar"}
              </button>
              <button
                onClick={() => run(() => deleteSource(s.id), "✔ Removida")}
                className="text-xs font-semibold text-risk-crit hover:underline"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {sources?.length === 0 && <p className="text-sm text-txt-3">Nenhuma fonte cadastrada.</p>}
      </div>
    </Card>
  );
}

// ── Fontes (coleta) ──────────────────────────────────────────
// Subsistema NOVO multi-plataforma (tabela `sources`): Instagram + YouTube.
// Separado da aba "Fontes" acima (monitored_sources), que alimenta o pipeline
// Instagram atual. Toda fonte cadastrada aqui nasce PAUSADA — nada é coletado
// até o admin ativar.
const COLETA_PLATFORMS: { value: Platform; label: string; placeholder: string }[] = [
  { value: "instagram", label: "Instagram", placeholder: "@perfil ou link do perfil" },
  { value: "youtube", label: "YouTube", placeholder: "@canal ou URL do canal" },
];

function FontesColetaSection() {
  const qc = useQueryClient();
  const { data: sources } = useQuery({ queryKey: ["coleta-sources"], queryFn: fetchColetaSources });
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["coleta-sources"] });

  const placeholder = COLETA_PLATFORMS.find((p) => p.value === platform)!.placeholder;
  // Prévia da normalização — mostra ao admin como o handle será salvo.
  const previa = handle.trim() ? normalizeHandle(platform, handle) : null;

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) refresh();
  }

  function adicionar() {
    if (!handle.trim()) return;
    run(() => addColetaSource(platform, handle, label).then((err) => {
      if (!err) { setHandle(""); setLabel(""); }
      return err;
    }), "✔ Fonte cadastrada (pausada — ative para começar a coletar)");
  }

  return (
    <Card title="Fontes de coleta (Instagram + YouTube)">
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {COLETA_PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && adicionar()}
          placeholder={placeholder}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && adicionar()}
          placeholder="Nome de exibição (opcional)"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
        />
      </div>

      {previa && (
        <p className="mt-2 text-xs text-txt-3">
          {previa.error
            ? <span className="text-risk-crit">{previa.error}</span>
            : <>Será salva como <code className="rounded bg-bg-2 px-1 py-0.5 text-txt-2">{platform}/{previa.handle}</code></>}
        </p>
      )}
      <p className="mt-2 text-xs text-txt-3">
        Toda fonte nasce <strong>pausada</strong>. Nenhuma coleta roda até você ativá-la aqui.
      </p>

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={adicionar}
          disabled={!!previa?.error || !handle.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Adicionar
        </button>
        <Feedback msg={msg} />
      </div>

      <div className="mt-3 space-y-1.5">
        {(sources ?? []).map((s: ColetaSource) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: s.platform === "youtube" ? "rgba(239,68,68,0.12)" : "rgba(168,85,247,0.12)",
                  color: s.platform === "youtube" ? "#EF4444" : "#A855F7",
                }}
              >
                {s.platform}
              </span>
              <span className={s.active ? "text-txt-1" : "text-txt-3"}>
                <span className="font-semibold">{s.handle}</span>
                {s.label && <span className="ml-1 text-txt-3">· {s.label}</span>}
                {!s.active && <span className="ml-2 text-[10px] uppercase tracking-wide text-txt-3">pausada</span>}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => run(() => toggleColetaSource(s.id, !s.active), s.active ? "✔ Pausada" : "✔ Ativada")}
                className="text-xs font-semibold text-txt-3 hover:text-txt-1"
              >
                {s.active ? "Pausar" : "Ativar"}
              </button>
              <button
                onClick={() => run(() => deleteColetaSource(s.id), "✔ Removida")}
                className="text-xs font-semibold text-risk-crit hover:underline"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {sources?.length === 0 && (
          <p className="text-sm text-txt-3">Nenhuma fonte de coleta cadastrada ainda.</p>
        )}
      </div>
    </Card>
  );
}

// ── Monitor de coleta ────────────────────────────────────────
// Lê collection_logs (join sources) e mostra o estado da coleta do dia.
// No começo não há nenhum registro — e isso é o esperado (estados vazios
// tratados como normal, não como erro).
const REDE_META: Record<string, { label: string; cor: string }> = {
  instagram: { label: "Instagram", cor: "#A855F7" },
  youtube: { label: "YouTube", cor: "#EF4444" },
};

/**
 * Radar de varredura — identidade visual do produto ("Radar"). Anéis
 * concêntricos + linha girando (varredura) + blips pulsando, simulando a busca
 * ativa. Verde quando há fontes ativas; âmbar quando ocioso. Respeita
 * prefers-reduced-motion (para a rotação, mantém o desenho).
 */
function RadarSweep({ ativo, size = 116 }: { ativo: boolean; size?: number }) {
  const cor = ativo ? "#22C55E" : "#F59E0B";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <style>{`
        @keyframes radar-spin { to { transform: rotate(360deg); } }
        @keyframes radar-blip { 0%,70%,100% { opacity: 0; transform: scale(.6); } 82% { opacity: 1; transform: scale(1); } }
        .radar-sweep { animation: radar-spin 3.4s linear infinite; }
        .radar-blip { animation: radar-blip 3.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .radar-sweep { animation: none; }
          .radar-blip { animation: none; opacity: .85; transform: none; }
        }
      `}</style>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" style={{ color: cor }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
        <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
        <circle cx="50" cy="50" r="16" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
        <line x1="4" y1="50" x2="96" y2="50" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
        <line x1="50" y1="4" x2="50" y2="96" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
      </svg>
      <div
        className="radar-sweep absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, ${cor}00 0deg, ${cor}00 296deg, ${cor}40 350deg, ${cor}99 360deg)`,
          WebkitMaskImage: "radial-gradient(circle, #000 62%, transparent 63%)",
          maskImage: "radial-gradient(circle, #000 62%, transparent 63%)",
        }}
      />
      <span className="radar-blip absolute h-1.5 w-1.5 rounded-full" style={{ background: cor, boxShadow: `0 0 8px ${cor}`, top: "30%", left: "64%", animationDelay: "0.4s" }} />
      <span className="radar-blip absolute h-1.5 w-1.5 rounded-full" style={{ background: cor, boxShadow: `0 0 8px ${cor}`, top: "62%", left: "38%", animationDelay: "1.9s" }} />
      <span className="absolute rounded-full" style={{ width: 6, height: 6, background: cor, boxShadow: `0 0 10px ${cor}`, top: "calc(50% - 3px)", left: "calc(50% - 3px)" }} />
    </div>
  );
}

function KpiBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-bg-2 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-txt-1">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; txt: string }> = {
    ok: { bg: "rgba(34,197,94,0.12)", fg: "#22C55E", txt: "ok" },
    erro: { bg: "rgba(239,68,68,0.12)", fg: "#EF4444", txt: "erro" },
    vazio: { bg: "rgba(148,163,184,0.14)", fg: "#94A3B8", txt: "vazio" },
  };
  const s = map[status] ?? map.vazio;
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: s.bg, color: s.fg }}>
      {s.txt}
    </span>
  );
}

function ColetaMonitorSection() {
  const ink = chartInk(useThemeStore((s) => s.theme));
  const { data: logs, isLoading: loadingLogs } = useQuery({
    queryKey: ["coleta-logs-hoje"], queryFn: fetchCollectionLogsHoje,
  });
  const { data: sources, isLoading: loadingSources } = useQuery({
    queryKey: ["coleta-fontes-unificadas"], queryFn: fetchFontesUnificadas,
  });
  const [filtroRede, setFiltroRede] = useState<"todas" | "instagram" | "youtube">("todas");

  const carregando = loadingLogs || loadingSources;
  const L = logs ?? [];
  const S = sources ?? [];
  const kpis = calcKpis(L, S);
  const redes = resumoPorRede(L, S);
  const volume = volumePorHora(L);

  const logsFiltrados = filtroRede === "todas" ? L : L.filter((l) => l.platform === filtroRede);

  const semNada = !carregando && S.length === 0 && L.length === 0;

  const chartOption = {
    grid: { top: 16, right: 12, bottom: 28, left: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: ink.tooltipBg, borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
    },
    xAxis: {
      type: "category",
      data: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`),
      axisLabel: { color: ink.axis, fontSize: 10, interval: 2 },
      axisLine: { lineStyle: { color: ink.axisLine } },
    },
    yAxis: {
      type: "value", minInterval: 1,
      axisLabel: { color: ink.axis, fontSize: 10 },
      splitLine: { lineStyle: { color: ink.grid } },
    },
    series: [{
      type: "bar", data: volume, barMaxWidth: 18,
      itemStyle: glassBar("#F97316"),
    }],
  };

  const varredura = kpis.fontesAtivas > 0;

  return (
    <div className="space-y-4">
      {/* Radar de varredura — identidade do produto, simula a busca ativa */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-bg-1 p-4">
        <RadarSweep ativo={varredura} />
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-txt-3">Radar de coleta</div>
          <div className="mt-1 text-lg font-extrabold text-txt-1">
            {carregando ? "Sincronizando…" : varredura ? "Varredura ativa" : "Radar ocioso"}
          </div>
          <div className="mt-0.5 text-sm text-txt-2">
            {varredura
              ? `Monitorando ${kpis.fontesAtivas} fonte${kpis.fontesAtivas > 1 ? "s" : ""} · a coleta roda a cada execução do pipeline.`
              : "Nenhuma fonte ativa. Ative uma fonte para o radar começar a varrer."}
          </div>
        </div>
      </div>

      {/* KPIs do dia */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiBox label="Itens coletados hoje" value={kpis.itensColetados} />
        <KpiBox label="Execuções" value={kpis.execucoes} />
        <KpiBox label="Fontes ativas" value={kpis.fontesAtivas} />
        <KpiBox label="Taxa de sucesso" value={`${kpis.taxaSucesso}%`} />
      </div>

      {semNada && (
        <Card title="Coleta">
          <p className="text-sm text-txt-2">
            Nenhuma coleta ainda. Cadastre e ative uma fonte na aba{" "}
            <strong>Fontes (coleta)</strong> — os resultados aparecem aqui após a próxima execução do pipeline.
          </p>
        </Card>
      )}

      {/* Cards por rede */}
      <div className="grid gap-3 sm:grid-cols-2">
        {redes.map((r) => {
          const meta = REDE_META[r.platform] ?? { label: r.platform, cor: "#94A3B8" };
          const aguardando = r.fontesAtivas === 0;
          const ultima = r.ultimaColeta
            ? new Date(r.ultimaColeta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : null;
          return (
            <div key={r.platform} className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold" style={{ color: meta.cor }}>{meta.label}</span>
                {aguardando && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "rgba(148,163,184,0.14)", color: "#94A3B8" }}>
                    aguardando configuração
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-extrabold text-txt-1">{r.fontesConfiguradas}</div>
                  <div className="text-[10px] uppercase tracking-wide text-txt-3">fontes ({r.fontesAtivas} ativas)</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-txt-1">{r.itensHoje}</div>
                  <div className="text-[10px] uppercase tracking-wide text-txt-3">itens hoje</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-txt-1">{ultima ?? "—"}</div>
                  <div className="text-[10px] uppercase tracking-wide text-txt-3">última coleta</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Volume ao longo do dia */}
      <Card title="Volume coletado ao longo do dia">
        {kpis.itensColetados === 0 ? (
          <p className="text-sm text-txt-3">Sem coletas hoje ainda.</p>
        ) : (
          <ReactECharts option={chartOption} style={{ height: 220 }} notMerge lazyUpdate />
        )}
      </Card>

      {/* Tabela de log */}
      <Card title="Registro de coletas (hoje)">
        <div className="mb-3 flex gap-1">
          {(["todas", "instagram", "youtube"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFiltroRede(r)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                filtroRede === r ? "bg-brand text-white" : "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
              }`}
            >
              {r === "todas" ? "Todas" : REDE_META[r]?.label ?? r}
            </button>
          ))}
        </div>

        {carregando ? (
          <p className="text-sm text-txt-3">Carregando…</p>
        ) : logsFiltrados.length === 0 ? (
          <p className="text-sm text-txt-3">Nenhum registro de coleta {filtroRede !== "todas" ? "para esta rede " : ""}hoje.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-txt-3">
                  <th className="py-1.5 pr-3 font-semibold">Hora</th>
                  <th className="py-1.5 pr-3 font-semibold">Rede</th>
                  <th className="py-1.5 pr-3 font-semibold">Fonte</th>
                  <th className="py-1.5 pr-3 font-semibold">Tipo</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Qtd.</th>
                  <th className="py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {logsFiltrados.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-txt-2">
                      {new Date(l.collected_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-3 text-txt-2">{REDE_META[l.platform]?.label ?? l.platform}</td>
                    <td className="py-1.5 pr-3 text-txt-1">
                      {l.source ? (l.source.label || l.source.handle) : <span className="text-txt-3">—</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-txt-2">{l.data_type}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold text-txt-1">{l.items_count}</td>
                    <td className="py-1.5"><StatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Usuários ─────────────────────────────────────────────────
// Caixa que exibe o link de convite gerado, com botão de copiar. Fica visível
// até o próximo convite — o admin copia e envia ao usuário por fora.
function InviteLinkBox({ email, link }: { email: string; link: string }) {
  const [copied, setCopied] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard bloqueado (contexto não-seguro): o usuário copia manualmente.
    }
  }
  return (
    <div className="mt-3 rounded-lg border border-brand/40 bg-brand/5 p-3">
      <div className="mb-1 text-xs font-semibold text-txt-2">
        Link de acesso para <span className="text-txt-1">{email}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg-1 px-2 py-1.5 text-xs text-txt-2 outline-none"
        />
        <button
          onClick={copiar}
          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["admin-users"], queryFn: fetchUsers });
  const [form, setForm] = useState({ email: "", full_name: "", role: "user" as Role });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ email: string; link: string } | null>(null);
  const onlineIds = useOnlineUserIds();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  async function convidar() {
    if (!form.email.trim()) {
      return setMsg({ ok: false, text: "E-mail é obrigatório." });
    }
    setBusy(true);
    setInvite(null);
    const email = form.email.trim();
    const res = await inviteUser(form);
    setBusy(false);
    if (res.error) return setMsg({ ok: false, text: res.error });
    if (res.link) {
      setInvite({ email, link: res.link });
      setMsg({
        ok: true,
        text: res.existing
          ? "✔ Link de acesso gerado (usuário já existia)"
          : "✔ Convite criado — copie o link abaixo e envie ao usuário",
      });
    } else {
      // Fallback: função antiga (ainda mandando e-mail) no ar.
      setMsg({ ok: true, text: "✔ Convite enviado por e-mail" });
    }
    setForm({ email: "", full_name: "", role: "user" });
    refresh();
  }

  async function mudarPapel(id: string, role: Role) {
    const err = await setUserRole(id, role);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "✔ Papel atualizado" });
    if (!err) refresh();
  }

  async function excluir(id: string, label: string) {
    if (!window.confirm(`Excluir ${label}? Essa ação não pode ser desfeita.`)) return;
    const err = await deleteUser(id);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "✔ Usuário excluído" });
    if (!err) refresh();
  }

  return (
    <div className="space-y-4">
      <Card title="Convidar usuário">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="email@prefeitura.ba.gov.br"
            type="email"
            className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="Nome completo"
            className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="user">Usuário comum</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={convidar}
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Gerando link…" : "Convidar"}
          </button>
          <Feedback msg={msg} />
        </div>
        <p className="mt-2 text-xs text-txt-3">
          O link de acesso é gerado na hora — copie e envie ao usuário (WhatsApp, e-mail…).
          Não depende do envio automático de e-mail do Supabase.
        </p>
        {invite && <InviteLinkBox email={invite.email} link={invite.link} />}
      </Card>

      <Card
        title={
          onlineIds.size > 0
            ? `Usuários do tenant · ${onlineIds.size} online agora`
            : "Usuários do tenant"
        }
      >
        <div className="space-y-1.5">
          {(users ?? []).map((u) => {
            const online = onlineIds.has(u.id);
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate font-semibold text-txt-1">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: online ? "#22C55E" : "var(--line)" }}
                      title={online ? "Com o dashboard aberto agora" : "Offline"}
                    />
                    <span className="truncate">{u.full_name || u.email}</span>
                    {online && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "rgba(34,197,94,0.12)", color: "#16A34A" }}>
                        Online
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-txt-3">{u.email}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <select
                    value={u.role}
                    onChange={(e) => mudarPapel(u.id, e.target.value as Role)}
                    className="rounded-lg border border-line bg-bg-1 px-2 py-1 text-xs font-semibold outline-none focus:border-brand"
                  >
                    <option value="user">Usuário</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => excluir(u.id, u.full_name || u.email || "")}
                    className="text-xs font-semibold text-risk-crit hover:underline"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            );
          })}
          {users?.length === 0 && <p className="text-sm text-txt-3">Nenhum usuário.</p>}
        </div>
      </Card>
    </div>
  );
}

// ── Notificações ─────────────────────────────────────────────
function NotificationsSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: fetchSettings });
  const [draft, setDraft] = useState<NotificationConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Merge com os defaults: configs salvas antes desta versão não têm as chaves
  // subtema_* — sem o merge, o slider receberia undefined (NaN).
  const cfg: NotificationConfig | null =
    draft ?? (data ? { ...DEFAULT_NOTIFICATION, ...data.notification_config } : null);

  if (!cfg) return <div className="text-sm text-txt-2">Carregando…</div>;
  const set = (patch: Partial<NotificationConfig>) => setDraft({ ...cfg, ...patch });

  async function salvar() {
    const err = await saveSettings({ notification_config: cfg! });
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: "✔ Notificações salvas" });
    qc.invalidateQueries({ queryKey: ["admin-settings"] });
  }

  return (
    <Card title="Alertas por limiar">
      <div className="space-y-3">
        <AlertaConfig
          titulo="IAD abaixo do limiar"
          descricao="Dispara quando o Índice de Aprovação Digital cai abaixo do valor configurado"
          limiar={cfg.iad_limiar} unidade="%" min={10} max={70} step={5}
          ativo={cfg.iad_ativo} cor="#EF4444"
          onChange={(l, a) => set({ iad_limiar: l, iad_ativo: a })}
        />
        <AlertaConfig
          titulo="% Negativo acima do limiar"
          descricao="Dispara quando o percentual de posts negativos ultrapassa o valor configurado"
          limiar={cfg.neg_limiar} unidade="%" min={30} max={90} step={5}
          ativo={cfg.neg_ativo} cor="#F97316"
          onChange={(l, a) => set({ neg_limiar: l, neg_ativo: a })}
        />
        <AlertaConfig
          titulo="Tema em crise por sentimento"
          descricao="Dispara quando um tema específico ultrapassa o % de negatividade configurado"
          limiar={cfg.tema_limiar} unidade="%" min={30} max={90} step={5}
          ativo={cfg.tema_ativo} cor="#8B5CF6"
          onChange={(l, a) => set({ tema_limiar: l, tema_ativo: a })}
        />
        <AlertaConfig
          titulo="Assunto repetido (volume de subtema)"
          descricao="Dispara quando um mesmo subtema aparece em N+ comentários em 24h — independente do risco de cada post. É a 'sensação popular' do áudio: 3 pessoas falando de buraco viram pauta."
          limiar={cfg.subtema_limiar} unidade=" com." min={2} max={15} step={1}
          ativo={cfg.subtema_ativo} cor="#F97316"
          onChange={(l, a) => set({ subtema_limiar: l, subtema_ativo: a })}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.canal_whats} onChange={(e) => set({ canal_whats: e.target.checked })} />
          <span className="text-txt-2">Canal WhatsApp</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.canal_email} onChange={(e) => set({ canal_email: e.target.checked })} />
          <span className="text-txt-2">Canal E-mail</span>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={salvar} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90">
          Salvar notificações
        </button>
        <Feedback msg={msg} />
      </div>
    </Card>
  );
}

// ── Clima ────────────────────────────────────────────────────
const CLIMA_FIELDS: { key: keyof Omit<ClimateThresholds, "faixas">; label: string; step: number }[] = [
  { key: "limiar_previsao", label: "Limiar de previsão (Δ risco para agravamento/melhora)", step: 0.5 },
  { key: "limiar_tempestade_com_alerta", label: "Risco mínimo p/ alerta elevar a 'tempestade'", step: 1 },
  { key: "override_resp_min", label: "Responsabilidade mín. p/ override SCCT (intencional)", step: 1 },
];

function ClimateSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: fetchSettings });
  const [draft, setDraft] = useState<ClimateThresholds | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const thr = draft ?? data?.climate_thresholds ?? null;

  if (!thr) return <div className="text-sm text-txt-2">Carregando…</div>;

  async function salvar() {
    const err = await saveSettings({ climate_thresholds: thr! });
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: "✔ Limiares do clima salvos" });
    qc.invalidateQueries({ queryKey: ["admin-settings"] });
  }

  return (
    <Card title="Limiares e override do clima político">
      <p className="mb-3 text-xs text-txt-3">
        O pipeline (agora.py) lê estes limiares de tenant_settings a cada execução — mexer aqui
        muda de fato como o boletim climático é gerado, inclusive as faixas de condição abaixo.
      </p>
      <div className="space-y-2">
        {CLIMA_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 flex-1 text-txt-2">{f.label}</span>
            <input
              type="number"
              step={f.step}
              value={thr[f.key]}
              onChange={(e) => setDraft({ ...thr, [f.key]: parseFloat(e.target.value) || 0 })}
              className="w-24 rounded-lg border border-line bg-bg-2 px-3 py-1.5 text-right text-sm outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-line bg-bg-2 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-txt-3">Faixas de condição</div>
        <div className="space-y-1 text-xs text-txt-2">
          {thr.faixas.map((fx, i) => (
            <div key={i} className="flex justify-between">
              <span>{fx[0]} – {fx[1]}</span>
              <span className="font-semibold text-txt-1">{fx[2]}{fx[3] ? ` · ${fx[3]}` : ""}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={salvar} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:opacity-90">
          Salvar limiares
        </button>
        <Feedback msg={msg} />
      </div>
    </Card>
  );
}
