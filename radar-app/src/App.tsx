import { useState } from "react";
import { CommandCenter } from "@/pages/CommandCenter";
import { ClimaPage } from "@/pages/ClimaPage";
import { CrisisCenter } from "@/pages/CrisisCenter";
import { AssistantPage } from "@/pages/AssistantPage";
import { InfluencersPage } from "@/pages/InfluencersPage";
import { NarrativesPage } from "@/pages/NarrativesPage";
import { TrendsPage } from "@/pages/TrendsPage";
import { ApprovalPage } from "@/pages/ApprovalPage";

type Page =
  | "command"
  | "clima"
  | "crisis"
  | "assistant"
  | "influencers"
  | "narratives"
  | "trends"
  | "approval";

const NAV: { id: Page | string; label: string; icon: string; active: boolean }[] = [
  { id: "command", label: "Comando", icon: "◉", active: true },
  { id: "clima", label: "Clima Político", icon: "☀", active: true },
  { id: "crisis", label: "Crises", icon: "✦", active: true },
  { id: "assistant", label: "Assistente IA", icon: "✧", active: true },
  { id: "approval", label: "Aprovação", icon: "▲", active: true },
  { id: "trends", label: "Tendências", icon: "∿", active: true },
  { id: "influencers", label: "Influenciadores", icon: "✷", active: true },
  { id: "narratives", label: "Narrativas", icon: "❋", active: true },
];

export default function App() {
  const [page, setPage] = useState<Page>("command");

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-bg-1 p-3 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand font-bold text-white">
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
                    ? "bg-bg-3 text-txt-1"
                    : n.active
                      ? "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
                      : "text-txt-3 disabled:cursor-not-allowed disabled:opacity-50"
                }`}
                title={n.active ? "" : "Em breve (Fase 3+)"}
              >
                <span className="w-4 text-center text-brand-2">{n.icon}</span>
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[10px] text-txt-3">
          Fase 3 · Postgres + Sheets (fallback)
        </div>
      </aside>

      {/* Nav mobile (topo) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex gap-1 border-b border-line bg-bg-1 p-2 md:hidden">
          {NAV.filter((n) => n.active).map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id as Page)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                n.id === page ? "bg-bg-3 text-txt-1" : "text-txt-2"
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
        <main className="flex-1 overflow-y-auto">
          {page === "command" && <CommandCenter />}
          {page === "clima" && <ClimaPage />}
          {page === "crisis" && <CrisisCenter />}
          {page === "assistant" && <AssistantPage />}
          {page === "approval" && <ApprovalPage />}
          {page === "trends" && <TrendsPage />}
          {page === "influencers" && <InfluencersPage />}
          {page === "narratives" && <NarrativesPage />}
        </main>
      </div>
    </div>
  );
}
