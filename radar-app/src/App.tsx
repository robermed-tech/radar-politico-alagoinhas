import { CommandCenter } from "@/pages/CommandCenter";

const NAV = [
  { id: "command", label: "Comando", icon: "◉", active: true },
  { id: "approval", label: "Aprovação", icon: "▲" },
  { id: "trends", label: "Tendências", icon: "∿" },
  { id: "risk", label: "Risco", icon: "⚠" },
  { id: "crisis", label: "Crises", icon: "✦" },
  { id: "influencers", label: "Influenciadores", icon: "✷" },
  { id: "narratives", label: "Narrativas", icon: "❋" },
  { id: "assistant", label: "Assistente IA", icon: "✧" },
];

export default function App() {
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
          {NAV.map((n) => (
            <button
              key={n.id}
              disabled={!n.active}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                n.active
                  ? "bg-bg-3 text-txt-1"
                  : "text-txt-3 hover:text-txt-2 disabled:cursor-not-allowed disabled:opacity-50"
              }`}
              title={n.active ? "" : "Em breve (Fase 2+)"}
            >
              <span className="w-4 text-center text-brand-2">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-2 text-[10px] text-txt-3">
          Fase 1 · lê do Google Sheets atual
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <CommandCenter />
      </main>
    </div>
  );
}
