import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertaConfig } from "@/components/AlertaConfig";
import {
  fetchSettings, saveSettings,
  fetchKeywords, addKeyword, toggleKeyword, deleteKeyword,
  fetchSources, addSource, toggleSource, deleteSource,
  fetchUsers, inviteUser, setUserRole, deleteUser,
  type ScoreWeights, type ClimateThresholds, type NotificationConfig,
} from "@/lib/admin";
import { fetchServiceStatus } from "@/lib/data";
import { DEFAULT_NOTIFICATION } from "@/lib/settings";
import { type Role } from "@/lib/auth";
import { IconWarningTriangle } from "@/components/icons";

type Tab = "score" | "relevancia" | "fontes" | "usuarios" | "notificacoes" | "clima";

const TABS: { id: Tab; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "relevancia", label: "Relevância" },
  { id: "fontes", label: "Fontes" },
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

// ── Usuários ─────────────────────────────────────────────────
function UsersSection() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["admin-users"], queryFn: fetchUsers });
  const [form, setForm] = useState({ email: "", full_name: "", role: "user" as Role });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  async function convidar() {
    if (!form.email.trim()) {
      return setMsg({ ok: false, text: "E-mail é obrigatório." });
    }
    setBusy(true);
    const err = await inviteUser(form);
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: "✔ Convite enviado por e-mail" });
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
            {busy ? "Convidando…" : "Convidar"}
          </button>
          <Feedback msg={msg} />
        </div>
      </Card>

      <Card title="Usuários do tenant">
        <div className="space-y-1.5">
          {(users ?? []).map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-semibold text-txt-1">{u.full_name || u.email}</div>
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
          ))}
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
