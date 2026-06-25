import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useQuery, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { ClimaPage } from "@/pages/ClimaPage"; // landing eager (sem ECharts)
// Demais páginas em lazy — cada uma vira um chunk separado (ECharts só carrega
// quando a página que usa gráficos é aberta).
const CommandCenter = lazy(() => import("@/pages/CommandCenter").then((m) => ({ default: m.CommandCenter })));
const CrisisCenter = lazy(() => import("@/pages/CrisisCenter").then((m) => ({ default: m.CrisisCenter })));
const AssistantPage = lazy(() => import("@/pages/AssistantPage").then((m) => ({ default: m.AssistantPage })));
const InfluencersPage = lazy(() => import("@/pages/InfluencersPage").then((m) => ({ default: m.InfluencersPage })));
const NarrativesPage = lazy(() => import("@/pages/NarrativesPage").then((m) => ({ default: m.NarrativesPage })));
const TrendsPage = lazy(() => import("@/pages/TrendsPage").then((m) => ({ default: m.TrendsPage })));
const ApprovalPage = lazy(() => import("@/pages/ApprovalPage").then((m) => ({ default: m.ApprovalPage })));
const GlossaryPage = lazy(() => import("@/pages/GlossaryPage").then((m) => ({ default: m.GlossaryPage })));
const FeedPage = lazy(() => import("@/pages/FeedPage").then((m) => ({ default: m.FeedPage })));
import { fetchRadar, filtrarPorPeriodo } from "@/lib/data";
import { calcIAD } from "@/lib/indices";
import { getWeather } from "@/lib/weather";
import { useThemeStore } from "@/stores/theme";

type Page =
  | "clima"
  | "command"
  | "feed"
  | "crisis"
  | "assistant"
  | "influencers"
  | "narratives"
  | "trends"
  | "approval"
  | "glossary";

const NAV: { id: Page | string; label: string; icon: string; active: boolean }[] = [
  { id: "clima", label: "Clima Político", icon: "☀", active: true },
  { id: "command", label: "Comando", icon: "◉", active: true },
  { id: "feed", label: "Feed", icon: "📋", active: true },
  { id: "crisis", label: "Crises", icon: "✦", active: true },
  { id: "assistant", label: "Assistente IA", icon: "✧", active: true },
  { id: "approval", label: "Aprovação", icon: "▲", active: true },
  { id: "trends", label: "Tendências", icon: "∿", active: true },
  { id: "influencers", label: "Influenciadores", icon: "✷", active: true },
  { id: "narratives", label: "Narrativas", icon: "❋", active: true },
  { id: "glossary", label: "Glossário", icon: "❔", active: true },
];

/** Iluminação azul no item ativo do menu (referência de design fornecida). */
const NAV_GLOW = {
  background: "linear-gradient(135deg, rgba(59,130,246,0.28), rgba(59,130,246,0.07))",
  boxShadow: "0 0 18px rgba(59,130,246,0.5), inset 0 0 0 1px rgba(59,130,246,0.55)",
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
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  const atualizar = () => qc.invalidateQueries();

  // Aplica tema no <html> + persiste
  useEffect(() => {
    document.documentElement.className = theme === "light" ? "theme-light" : "theme-dark";
    localStorage.setItem("radar_theme", theme);
  }, [theme]);

  // Clima predominante (7 dias) — usado no accent e no rodapé (o background é
  // um degradê azul fixo, definido no index.css por tema).
  const { data, dataUpdatedAt } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 5 * 60 * 1000 });
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

  return (
    <div className="flex h-full">
      <aside
        className="hidden w-56 shrink-0 flex-col border-r border-line bg-bg-1 p-3 md:flex"
        style={{ boxShadow: "6px 0 28px -10px rgba(0,0,0,0.30)" }}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg font-bold text-white shadow-md"
            style={{ background: wx.accent }}
          >
            ◉
          </span>
          <span className="font-extrabold tracking-tight">Radar Político</span>
        </div>
        <nav className="flex flex-col gap-1.5">
          {NAV.map((n) => {
            const isCurrent = n.active && n.id === page;
            return (
              <button
                key={n.id}
                disabled={!n.active}
                onClick={() => n.active && setPage(n.id as Page)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-all duration-200 ${
                  isCurrent
                    ? "text-white"
                    : n.active
                      ? "bg-bg-2 text-txt-2 shadow-sm hover:bg-bg-3 hover:text-txt-1 hover:shadow-md"
                      : "text-txt-3 disabled:cursor-not-allowed disabled:opacity-50"
                }`}
                style={isCurrent ? NAV_GLOW : undefined}
              >
                <span
                  className="w-4 text-center"
                  style={{ color: isCurrent ? "#93C5FD" : "var(--txt2)" }}
                >
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
          <div className="px-2 text-[10px] text-txt-3">
            {wx.icon} {wx.label} · {fetching ? "atualizando…" : horaAtualizado ? `atualizado ${horaAtualizado}` : "Postgres"}
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Nav mobile (topo) */}
        <div className="flex items-center gap-1 border-b border-line bg-bg-1 p-2 md:hidden">
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {NAV.filter((n) => n.active).map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id as Page)}
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
        <main className="flex-1 overflow-y-auto">
          <Suspense fallback={<div className="p-8 text-txt-2">Carregando…</div>}>
            {page === "clima" && <ClimaPage />}
            {page === "command" && <CommandCenter />}
            {page === "feed" && <FeedPage />}
            {page === "crisis" && <CrisisCenter />}
            {page === "assistant" && <AssistantPage />}
            {page === "approval" && <ApprovalPage />}
            {page === "trends" && <TrendsPage />}
            {page === "influencers" && <InfluencersPage />}
            {page === "narratives" && <NarrativesPage />}
            {page === "glossary" && <GlossaryPage />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
