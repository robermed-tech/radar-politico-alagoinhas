import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useQuery, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { ClimaPage } from "@/pages/ClimaPage"; // landing eager (sem ECharts)
// Demais páginas em lazy — cada uma vira um chunk separado.
const AlertasAcoesPage = lazy(() => import("@/pages/AlertasAcoesPage").then((m) => ({ default: m.AlertasAcoesPage })));
const TemasPage = lazy(() => import("@/pages/TemasPage").then((m) => ({ default: m.TemasPage })));
const FeedPage = lazy(() => import("@/pages/FeedPage").then((m) => ({ default: m.FeedPage })));
const AdminPage = lazy(() => import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const AceitarConvitePage = lazy(() =>
  import("@/pages/AceitarConvitePage").then((m) => ({ default: m.AceitarConvitePage }))
);
const ApprovalPage = lazy(() => import("@/pages/ApprovalPage").then((m) => ({ default: m.ApprovalPage })));
const AlertasHistPage = lazy(() => import("@/pages/AlertasHistPage").then((m) => ({ default: m.AlertasHistPage })));
const BairrosPage = lazy(() => import("@/pages/BairrosPage").then((m) => ({ default: m.BairrosPage })));
const PedidosPage = lazy(() => import("@/pages/PedidosPage").then((m) => ({ default: m.PedidosPage })));
const PerfilPage = lazy(() => import("@/pages/PerfilPage").then((m) => ({ default: m.PerfilPage })));
import { fetchRadar, fetchPipelineHealth, filtrarPorPeriodo } from "@/lib/data";
import { calcIAD } from "@/lib/indices";
import { getWeather } from "@/lib/weather";
import { useThemeStore } from "@/stores/theme";
import { RequireAuth, RequireAdmin } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { signOut } from "@/lib/auth";
import { PipelineHealthBanner } from "@/components/PipelineHealthBanner";
import { useHydrateSettings } from "@/lib/settings";
import { useTrackPresence } from "@/lib/presence";

type Page =
  | "clima"
  | "actions"
  | "feed"
  | "topics"
  | "bairros"
  | "pedidos"
  | "perfil"
  | "admin"
  // avançado
  | "approval"
  | "alerts-hist";

interface NavItem { id: Page; label: string; icon: JSX.Element }

function NIcoDashboard() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
}
function NIcoBell() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
}
function NIcoBarChart() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="5" y1="20" x2="5" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="19" y1="20" x2="19" y2="4"/></svg>;
}
function NIcoMessage() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}
function NIcoTrending() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
}
function NIcoSliders() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="4" y1="5" x2="7" y2="5"/><circle cx="9" cy="5" r="2"/><line x1="11" y1="5" x2="20" y2="5"/><line x1="4" y1="12" x2="13" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="17" y1="12" x2="20" y2="12"/><line x1="4" y1="19" x2="7" y2="19"/><circle cx="9" cy="19" r="2"/><line x1="11" y1="19" x2="20" y2="19"/></svg>;
}
function NIcoMapPin() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
}
function NIcoInbox() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>;
}
function NIcoUser() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function NIcoAlertHist() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="12" y1="2" x2="12" y2="4"/></svg>;
}

const NAV_MAIN: NavItem[] = [
  { id: "clima",       label: "Estação Meteorológica", icon: <NIcoDashboard /> },
  { id: "approval",    label: "Análise do Clima",      icon: <NIcoBarChart /> },
  { id: "feed",        label: "O que o povo diz",      icon: <NIcoMessage /> },
  { id: "pedidos",     label: "Pedidos do Povo",       icon: <NIcoInbox /> },
  { id: "bairros",     label: "Mapa da Cidade",        icon: <NIcoMapPin /> },
  { id: "perfil",      label: "Análise por Perfil",    icon: <NIcoUser /> },
  { id: "topics",      label: "Previsões",             icon: <NIcoTrending /> },
  { id: "actions",     label: "Alertas & Ações",       icon: <NIcoBell /> },
  { id: "alerts-hist", label: "Histórico Alertas",     icon: <NIcoAlertHist /> },
  { id: "admin",       label: "Configuração",          icon: <NIcoSliders /> },
];

/** Botão ativo do menu: pílula laranja com degradê, glow quente e fio de luz. */
const NAV_GLOW = {
  background: "linear-gradient(180deg, #FB923C 0%, var(--brand) 100%)",
  boxShadow:
    "0 8px 22px -6px var(--brand-glow), inset 0 1px 0 rgba(255,255,255,0.28)",
} as const;

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("clima");
  const { session, isAdmin, isInviteLanding, dismissInviteLanding } = useAuth();
  const userEmail = session?.user?.email ?? null;
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  const atualizar = () => qc.invalidateQueries();

  // Hidrata os pesos do score (aba "Score" da Configuração) a partir de
  // tenant_settings — sem isto os cálculos de IAD/Risco ignoram o que o admin
  // salva no banco.
  useHydrateSettings();

  // Anuncia presença ("dashboard aberto agora") para o indicador da aba
  // Usuários — ver src/lib/presence.ts.
  useTrackPresence(session?.user?.id);

  // Itens de menu visíveis conforme o papel (Configuração só p/ admin).
  const navMain = NAV_MAIN.filter((n) => n.id !== "admin" || isAdmin);

  // Aplica tema no <html> + persiste
  useEffect(() => {
    document.documentElement.className = theme === "light" ? "theme-light" : "theme-dark";
    localStorage.setItem("radar_theme", theme);
  }, [theme]);

  // Clima predominante (7 dias) — usado no accent e no rodapé (o background é
  // um degradê azul fixo, definido no index.css por tema).
  const { data, dataUpdatedAt } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 5 * 60 * 1000 });
  const { data: pipelineHealth } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: fetchPipelineHealth,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const horaAtualizado = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  const wx = useMemo(() => {
    if (!data) return getWeather(50);
    const posts = filtrarPorPeriodo(data.data, 7);
    return getWeather(posts.length ? Math.round(calcIAD(posts)) : 50);
  }, [data]);

  const ThemeToggle = ({ compact = false }: { compact?: boolean }) => (
    <button
      onClick={toggleTheme}
      className={`glass-btn flex items-center justify-center gap-2 rounded-lg text-txt-1 ${compact ? "px-2 py-1.5" : "w-full px-3 py-2 text-sm font-semibold"}`}
      title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label="Alternar tema claro/escuro"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      {!compact && <span>{theme === "dark" ? "Claro" : "Escuro"}</span>}
    </button>
  );

  const RefreshButton = ({ compact = false }: { compact?: boolean }) => (
    <button
      onClick={atualizar}
      disabled={fetching}
      className={`glass-btn flex items-center justify-center gap-2 rounded-lg text-txt-1 ${compact ? "px-2 py-1.5" : "w-full px-3 py-2 text-sm font-semibold"}`}
      title="Atualizar com os dados mais recentes"
      aria-label="Atualizar dados"
    >
      <RefreshIcon spinning={fetching} />
      {!compact && <span>{fetching ? "Atualizando…" : "Atualizar dados"}</span>}
    </button>
  );

  if (isInviteLanding) {
    return (
      <RequireAuth>
        <Suspense fallback={<div className="p-8 text-txt-2">Carregando…</div>}>
          <AceitarConvitePage onDone={dismissInviteLanding} />
        </Suspense>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
    <div className="flex h-full">
      <aside
        className="hidden w-56 shrink-0 flex-col border-r border-line bg-bg-1 p-3 md:flex"
        style={{ boxShadow: "6px 0 28px -10px rgba(0,0,0,0.30)" }}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg shadow-md"
            style={{ background: "var(--brand)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="2" fill="white"/>
              <circle cx="12" cy="12" r="7"/>
            </svg>
          </span>
          <div className="leading-tight">
            <div className="text-[14px] font-extrabold uppercase tracking-[0.06em] text-txt-1">Radar</div>
            <div className="text-[12px] font-medium tracking-widest text-txt-3">Político</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1.5">
          {navMain.map((n) => {
            const isCurrent = n.id === page;
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold tracking-wide transition-all duration-200 ${
                  isCurrent
                    ? ""
                    : "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
                }`}
                style={isCurrent ? { ...NAV_GLOW, color: "#1A0F02" } : undefined}
              >
                <span className="flex h-4 w-4 items-center justify-center shrink-0" style={{ color: isCurrent ? "#1A0F02" : "var(--txt2)" }}>
                  {n.icon}
                </span>
                {n.label}
              </button>
            );
          })}

        </nav>
        <div className="mt-auto space-y-2 pt-3">
          <RefreshButton />
          <ThemeToggle />
          {userEmail && (
            <button
              onClick={() => signOut()}
              className="glass-btn flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-txt-2 hover:text-txt-1"
              title="Sair da conta"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sair
            </button>
          )}
          <div className="px-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-txt-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
              </svg>
              {userEmail ? userEmail.split("@")[0] : wx.label}
            </div>
            <div className="mt-0.5 text-[12px] tracking-wide text-txt-3">
              {fetching ? "atualizando…" : horaAtualizado ? `Atualizado às ${horaAtualizado}` : "Conectado ao Postgres"}
            </div>
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Nav mobile (topo) */}
        <div className="flex items-center gap-1 border-b border-line bg-bg-1 p-2 md:hidden">
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {navMain.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 ${
                  n.id === page ? "text-white" : "text-txt-2"
                }`}
                style={n.id === page ? NAV_GLOW : undefined}
              >
                {n.label}
              </button>
            ))}
          </div>
          <RefreshButton compact />
          <ThemeToggle compact />
        </div>
        <PipelineHealthBanner health={pipelineHealth} />
        <main className="flex-1 overflow-y-auto">
          <Suspense fallback={<div className="p-8 text-txt-2">Carregando…</div>}>
            {page === "clima"    && <ClimaPage onVerFeed={() => setPage("feed")} />}
            {page === "actions"  && <AlertasAcoesPage />}
            {page === "feed"     && <FeedPage />}
            {page === "pedidos"  && <PedidosPage />}
            {page === "bairros"  && <BairrosPage />}
            {page === "perfil"   && <PerfilPage />}
            {page === "topics"   && <TemasPage />}
            {page === "admin"    && <RequireAdmin><AdminPage /></RequireAdmin>}
            {/* Avançado */}
            {page === "approval"     && <ApprovalPage />}
            {page === "alerts-hist"  && <AlertasHistPage />}
          </Suspense>
        </main>
      </div>
    </div>
    </RequireAuth>
  );
}
