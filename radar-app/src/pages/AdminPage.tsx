import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchSettings, saveSettings, testarAlertaSuporte,
  fetchUsers, inviteUser, setUserRole, deleteUser,
  type ScoreWeights, type ClimateThresholds, type NotificationConfig,
} from "@/lib/admin";
import {
  fetchCollectionLogsHoje, fetchFontesUnificadas,
  calcKpis, resumoPorRede, volumePorHora,
} from "@/lib/collection";
import { fetchServiceStatus, fetchAlertHistory } from "@/lib/data";
import { CartaoCredito } from "@/components/CartaoCredito";
import { fmtQuandoCredito, PCT_ALERTA_WHATSAPP } from "@/lib/creditos";
import { DEFAULT_NOTIFICATION } from "@/lib/settings";
import { type Role } from "@/lib/auth";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";
import { useOnlineUserIds } from "@/lib/presence";
import { Card, Feedback } from "@/components/FormCard";
import { ConfirmaModal } from "@/components/ConfirmaModal";

// Reunião de 24/07: as abas "Fontes (coleta)" e "Notificações" saíram.
// Revisão de 25/07: "Relevância" e "Fontes" viraram páginas próprias na barra
// lateral, abertas a qualquer usuário (ver RelevanciaPage/FontesPage e a
// migration 007). Sobra aqui o que continua restrito ao administrador —
// score, limiares de clima, usuários e o monitor de coleta.
// 31/07: "Alerta de Suporte" entra como aba nova — o número que recebe o
// aviso de "pipeline parou" só pode ser trocado por quem já está dentro
// desta página (admin-only por herança do RequireAdmin em App.tsx).
type Tab = "score" | "monitor" | "usuarios" | "clima" | "suporte";

const TABS: { id: Tab; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "monitor", label: "Monitor de coleta" },
  { id: "usuarios", label: "Usuários" },
  { id: "clima", label: "Clima" },
  { id: "suporte", label: "Alerta de Suporte" },
];


/**
 * Uso de créditos Apify — sempre visível (antes só aparecia acima de 70% de
 * uso, então na prática nunca era visto: no consumo normal de Alagoinhas
 * fica em 0-5%/mês). Vira widget de acompanhamento contínuo, com o mesmo
 * alerta visual de antes só quando o uso fica alto.
 *
 * O desenho e a escrita do número saíram daqui em 06/08 para `CartaoCredito` +
 * `lib/creditos.ts`: este cartão e o banner de saúde exibiam a MESMA linha de
 * `service_status` com grafias diferentes ("$29.33 · 101%" contra
 * "US$ 29,33"), e a 101% aqui ainda se lia "quase esgotados". Ver o cabeçalho
 * de lib/creditos.ts.
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

  return (
    <CartaoCredito
      nome="Apify"
      status={status}
      carregando={isLoading}
      descricao="Serviço que coleta as publicações e os comentários do Instagram."
      vazio="Sem leitura ainda — aparece aqui depois da próxima execução do ÁGORA."
      acao="Com o teto fechado a coleta volta com 0 posts. Recarregue em apify.com/billing."
    />
  );
}

/**
 * Uso da API Anthropic (06/08/26) — o serviço que ANALISA, ao lado do que
 * coleta. Os dois param o produto de jeitos diferentes e, até aqui, só um
 * tinha medidor: sem crédito na Apify o pipeline não traz post nenhum; sem
 * crédito na Anthropic ele traz e grava `_DEFAULTS_ANALISE` em tudo, com o run
 * saindo VERDE (incidente de 01/08).
 *
 * O número é o CONSUMO ESTIMADO deste pipeline, não o saldo da conta: a
 * Anthropic não publica saldo por chave (não há equivalente ao
 * /users/me/limits da Apify), então `agora.py::registrar_uso_anthropic` soma
 * os tokens de cada resposta pelo preço de tabela do modelo. A tela diz isso
 * com todas as letras — exibir um "saldo" que ninguém mediu seria pior que não
 * ter número.
 *
 * "Funciona junto com o alerta de WhatsApp" literalmente: o mesmo limiar de
 * 80% que dispara a mensagem acende a barra aqui, e o rodapé mostra o último
 * disparo registrado em `alerta_historico` (com o provedor que entregou), para
 * o admin ver na tela que a mensagem saiu — ou que nunca saiu.
 */
function MonitorAnthropic() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["service-status-anthropic"],
    queryFn: () => fetchServiceStatus("anthropic"),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  // `alerta_historico` é a tabela do Alerta de Suporte (avisos automáticos de
  // saúde do pipeline). Não confundir com a página "Histórico de Alertas", que
  // lê `message_log` — envio MANUAL ao secretário, outro assunto.
  const { data: alertas } = useQuery({
    queryKey: ["alert-history"],
    queryFn: () => fetchAlertHistory(100),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // `alerta_suporte._registrar_alerta` grava "[origem] motivo" na mensagem —
  // é por esse prefixo que se separa o alerta da Anthropic dos demais.
  const ultimo = (alertas ?? []).find(
    (a) => a.tipo === "suporte" && (a.mensagem || "").startsWith("[anthropic")
  );

  return (
    <CartaoCredito
      nome="Anthropic"
      status={status}
      carregando={isLoading}
      descricao="Modelo que classifica sentimento, tema e risco. Consumo ESTIMADO deste pipeline pelos tokens de cada resposta (a API não publica saldo da conta); o teto vem de ANTHROPIC_BUDGET_USD."
      vazio="Sem leitura ainda — o consumo aparece aqui depois da próxima execução do ÁGORA que chamar o modelo."
      acao="Sem crédito, a análise é gravada com valores padrão e o painel para de receber leitura nova. Compre crédito em console.anthropic.com."
    >
      <div className="mt-3 border-t border-line/60 pt-2 text-[12px] text-txt-3">
        {ultimo ? (
          <>
            Último aviso por WhatsApp: <span className="font-semibold text-txt-2">{fmtQuandoCredito(ultimo.criado_em)}</span>
            {ultimo.canal && <> · canal <span className="font-semibold text-txt-2">{ultimo.canal}</span></>}
          </>
        ) : (
          <>Nenhum aviso disparado até agora. O alerta sai por WhatsApp a partir de {PCT_ALERTA_WHATSAPP}% do teto.</>
        )}
      </div>
    </CartaoCredito>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("score");

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Administração</h1>
        <p className="text-base text-txt-2">Configuração do Viratempo · acesso exclusivo de administradores</p>
      </div>
      <ApifyStatusBanner />

      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg-1 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.id ? "bg-brand text-brand-ink" : "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "score" && <ScoreSection />}
      {tab === "monitor" && <ColetaMonitorSection />}
      {tab === "usuarios" && <UsersSection />}
      {tab === "clima" && <ClimateSection />}
      {tab === "suporte" && <SuporteSection />}
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
      {/* Prévia 3 de 04/08: os campos numéricos viram barras deslizantes na
          marca, com o valor na display ao lado — o peso relativo dos termos
          fica visível de relance. A precisão continua a mesma (passo 0,05). */}
      <div className="space-y-1">
        {SCORE_FIELDS.map((f) => (
          <label
            key={f.key}
            className="grid items-center gap-x-4 py-1.5 text-sm"
            style={{ gridTemplateColumns: "minmax(120px, 190px) 1fr 56px" }}
          >
            <span className="min-w-0 truncate font-semibold text-txt-2">{f.label}</span>
            <input
              type="range"
              step={0.05}
              min={0}
              max={1}
              value={weights[f.key]}
              onChange={(e) =>
                setDraft({ ...weights, [f.key]: parseFloat(e.target.value) || 0 })
              }
              className="h-2 w-full cursor-pointer"
              style={{ accentColor: "var(--brand)" }}
              aria-label={`Peso de ${f.label}`}
            />
            <span className="tnum text-right font-display text-base font-bold text-txt-1">
              {weights[f.key].toFixed(2)}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={salvar}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90"
        >
          Salvar pesos
        </button>
        <Feedback msg={msg} />
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
      <div className="text-[13px] font-semibold uppercase tracking-wide text-txt-3">{label}</div>
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
    <span className="rounded px-1.5 py-0.5 text-[12px] font-bold uppercase" style={{ background: s.bg, color: s.fg }}>
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
      axisLabel: { color: ink.axis, fontSize: 12, interval: 2 },
      axisLine: { lineStyle: { color: ink.axisLine } },
    },
    yAxis: {
      type: "value", minInterval: 1,
      axisLabel: { color: ink.axis, fontSize: 12 },
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

      {/* Consumo dos dois serviços externos que podem parar o produto: o que
          COLETA (Apify, no topo da página) e o que ANALISA (Anthropic). */}
      <MonitorAnthropic />

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
                  <span className="rounded px-1.5 py-0.5 text-[12px] font-bold uppercase" style={{ background: "rgba(148,163,184,0.14)", color: "#94A3B8" }}>
                    aguardando configuração
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-extrabold text-txt-1">{r.fontesConfiguradas}</div>
                  <div className="text-[12px] uppercase tracking-wide text-txt-3">fontes ({r.fontesAtivas} ativas)</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-txt-1">{r.itensHoje}</div>
                  <div className="text-[12px] uppercase tracking-wide text-txt-3">itens hoje</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-txt-1">{ultima ?? "—"}</div>
                  <div className="text-[12px] uppercase tracking-wide text-txt-3">última coleta</div>
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
                filtroRede === r ? "bg-brand text-brand-ink" : "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
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
                <tr className="text-[13px] uppercase tracking-wide text-txt-3">
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
          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-ink transition hover:opacity-90"
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

  // Pop-up de confirmação na linha visual do painel (03/08), no lugar do
  // window.confirm nativo.
  const [excluindo, setExcluindo] = useState<{ id: string; label: string } | null>(null);

  async function excluir(id: string) {
    setExcluindo(null);
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
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90 disabled:opacity-50"
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
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold uppercase" style={{ background: "rgba(34,197,94,0.12)", color: "#16A34A" }}>
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
                    onClick={() => setExcluindo({ id: u.id, label: u.full_name || u.email || "" })}
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

      {excluindo && (
        <ConfirmaModal
          titulo={`Excluir ${excluindo.label}?`}
          mensagem="O acesso ao painel é revogado na hora. Essa ação não pode ser desfeita."
          rotuloConfirmar="Excluir usuário"
          onConfirmar={() => void excluir(excluindo.id)}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
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
        <div className="section-label mb-2">Faixas de condição</div>
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
        <button onClick={salvar} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90">
          Salvar limiares
        </button>
        <Feedback msg={msg} />
      </div>
    </Card>
  );
}

// ── Alerta de Suporte ────────────────────────────────────────
// Numero (WhatsApp e/ou SMS) que recebe o aviso automatico assim que o
// pipeline ÁGORA parar — ver alerta_suporte.py. Aditivo ao alerta de grupo
// que ja existia (EVOLUTION_GROUP_ID): nao substitui, so soma um destino
// que o admin controla sem depender de secret do GitHub.
function SuporteSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: fetchSettings });
  const [draft, setDraft] = useState<NotificationConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testando, setTestando] = useState(false);
  // Merge com os defaults é OBRIGATÓRIO, não conveniência: a linha de
  // tenant_settings foi semeada na migration 002, muito antes destes campos
  // existirem, então `notification_config` no banco real não traz nenhum
  // `alerta_suporte_*`. Sem o merge, `nc.alerta_suporte_numero` é undefined e
  // o `.replace()` logo abaixo estoura em tempo de render — como não há error
  // boundary, o React desmonta a árvore e a aba inteira some da tela. Mesmo
  // padrão de useNotificationConfig() em lib/settings.ts.
  const nc = draft ?? (data ? { ...DEFAULT_NOTIFICATION, ...data.notification_config } : null);

  if (!nc) return <div className="text-sm text-txt-2">Carregando…</div>;

  async function salvar() {
    const err = await saveSettings({ notification_config: nc! });
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: "✔ Alerta de suporte salvo" });
    qc.invalidateQueries({ queryKey: ["admin-settings"] });
  }

  async function testar() {
    setTestando(true);
    setMsg(null);
    const err = await testarAlertaSuporte();
    setTestando(false);
    setMsg(
      err
        ? { ok: false, text: err }
        : { ok: true, text: "✔ Teste disparado — confira o WhatsApp/SMS cadastrado em alguns segundos" }
    );
  }

  const numeroValido = nc.alerta_suporte_numero.replace(/\D/g, "").length >= 10;
  const podeTestar = numeroValido && (nc.alerta_suporte_whatsapp || nc.alerta_suporte_sms) && !testando;

  return (
    <Card title="Alerta de suporte — quando o Radar parar">
      <p className="mb-3 text-xs text-txt-3">
        Assim que o pipeline ÁGORA parar de funcionar — travar, dar erro ou simplesmente não rodar no
        horário esperado — um aviso automático é enviado para este número, explicando o motivo provável
        e sugerindo uma correção. O monitoramento roda 24h por dia, todos os dias, por dois vigias
        independentes: o próprio pipeline (avisa na hora, de dentro do erro) e um heartbeat externo que
        confere a cada 15 minutos se o cron ainda está disparando.
      </p>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-txt-2">Número (WhatsApp e/ou SMS, com DDD)</span>
          <input
            type="tel"
            value={nc.alerta_suporte_numero}
            onChange={(e) => setDraft({ ...nc, alerta_suporte_numero: e.target.value })}
            placeholder="75 9 9999-0000"
            className="w-full max-w-xs rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-txt-2">
            <input
              type="checkbox"
              checked={nc.alerta_suporte_whatsapp}
              onChange={(e) => setDraft({ ...nc, alerta_suporte_whatsapp: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            WhatsApp
          </label>
          <label className="flex items-center gap-2 text-sm text-txt-2">
            <input
              type="checkbox"
              checked={nc.alerta_suporte_sms}
              onChange={(e) => setDraft({ ...nc, alerta_suporte_sms: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            SMS
          </label>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={salvar}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90"
        >
          Salvar
        </button>
        <button
          onClick={testar}
          disabled={!podeTestar}
          title={numeroValido ? "" : "Cadastre um número válido primeiro"}
          className="rounded-lg border border-line bg-bg-2 px-4 py-2 text-sm font-semibold text-txt-1 transition hover:bg-bg-3 disabled:opacity-40"
        >
          {testando ? "Enviando…" : "Enviar teste"}
        </button>
        <Feedback msg={msg} />
      </div>
    </Card>
  );
}
