import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CommandCenter } from "@/pages/CommandCenter";
import { ClimaPage } from "@/pages/ClimaPage";
import { CrisisCenter } from "@/pages/CrisisCenter";
import { AssistantPage } from "@/pages/AssistantPage";
import { InfluencersPage } from "@/pages/InfluencersPage";
import { NarrativesPage } from "@/pages/NarrativesPage";
import { TrendsPage } from "@/pages/TrendsPage";
import { ApprovalPage } from "@/pages/ApprovalPage";
import { GlossaryPage } from "@/pages/GlossaryPage";
import { fetchRadar, filtrarPorPeriodo } from "@/lib/data";
import { calcIAD } from "@/lib/indices";
import { getWeather } from "@/lib/weather";
import { useThemeStore } from "@/stores/theme";

type Page =
  | "clima"
  | "command"
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
  { id: "crisis", label: "Crises", icon: "✦", active: true },
  { id: "assistant", label: "Assistente IA", icon: "✧", active: true },
  { id: "approval", label: "Aprovação", icon: "▲", active: true },
  { id: "trends", label: "Tendências", icon: "∿", active: true },
  { id: "influencers", label: "Influenciadores", icon: "✷", active: true },
  { id: "narratives", label: "Narrativas", icon: "❋", active: true },
  { id: "glossary", label: "Glossário", icon: "❔", active: true },
];

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

export default function App() {
  const [page, setPage] = useState<Page>("clima");
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  // Aplica tema no <html> + persiste
  useEffect(() => {
    document.documentElement.className = theme === "light" ? "theme-light" : "theme-dark";
    localStorage.setItem("radar_theme", theme);
  }, [theme]);

  // Clima predominante (7 dias) controla o background global
  const { data } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 5 * 60 * 1000 });
  const wx = useMemo(() => {
    if (!data) return getWeather(50);
    const posts = filtrarPorPeriodo(data.data, 7);
    return getWeather(posts.length ? Math.round(calcIAD(posts)) : 50);
  }, [data]);

  useEffect(() => {
    document.documentElement.style.setProperty("--wx-bg", theme === "light" ? wx.bgLight : wx.bgApp);
  }, [wx, theme]);

  const ThemeToggle = ({ compact = false }: { compact?: boolean }) => (
    <button
      onClick={toggleTheme}
      className={`glass-btn flex items-center gap-2 rounded-lg text-txt-1 ${compact ? "px-2 py-1.5" : "px-3 py-2 text-sm font-semibold"}`}
      title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label="Alternar tema claro/escuro"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      {!compact && <span>{theme === "dark" ? "Claro" : "Escuro"}</span>}
    </button>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-bg-1 p-3 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg font-bold text-white"
            style={{ background: wx.accent }}
          >
            ◉
          </span>
          <span className="font-extrabold tracking-tight">Radar Político</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const isCurrent = n.active && n.id === page;
            return (
              <button
                key={n.id}
                disabled={!n.active}
                onClick={() => n.active && setPage(n.id as Page)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                  isCurrent
                    ? "glass-btn text-txt-1"
                    : n.active
                      ? "text-txt-2 hover:bg-bg-3 hover:text-txt-1"
                      : "text-txt-3 disabled:cursor-not-allowed disabled:opacity-50"
                }`}
              >
                <span className="w-4 text-center" style={{ color: isCurrent ? wx.accent : "var(--txt2)" }}>
                  {n.icon}
                </span>
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2">
          <ThemeToggle />
          <div className="px-2 text-[10px] text-txt-3">{wx.icon} {wx.label} · Postgres</div>
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
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  n.id === page ? "glass-btn text-txt-1" : "text-txt-2"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
          <ThemeToggle compact />
        </div>
        <main className="flex-1 overflow-y-auto">
          {page === "clima" && <ClimaPage />}
          {page === "command" && <CommandCenter />}
          {page === "crisis" && <CrisisCenter />}
          {page === "assistant" && <AssistantPage />}
          {page === "approval" && <ApprovalPage />}
          {page === "trends" && <TrendsPage />}
          {page === "influencers" && <InfluencersPage />}
          {page === "narratives" && <NarrativesPage />}
          {page === "glossary" && <GlossaryPage />}
        </main>
      </div>
    </div>
  );
}
