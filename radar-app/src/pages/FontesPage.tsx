import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSources, addSource, toggleSource, deleteSource } from "@/lib/admin";
import {
  fetchSources as fetchColetaSources, addSource as addColetaSource,
  toggleSource as toggleColetaSource, deleteSource as deleteColetaSource,
  normalizeHandle, type Platform, type Source as ColetaSource,
} from "@/lib/sources";
import { Card, Feedback } from "@/components/FormCard";

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

// Uma aba só para todas as plataformas (reunião 24/07). Cada plataforma vai
// para o backend certo: Instagram → monitored_sources (pipeline ÁGORA atual);
// YouTube → sources (subsistema de coleta multi-plataforma, nasce pausada).
function SourcesSection() {
  const qc = useQueryClient();
  const { data: sources } = useQuery({ queryKey: ["admin-sources"], queryFn: fetchSources });
  const { data: coletaSources } = useQuery({ queryKey: ["coleta-sources"], queryFn: fetchColetaSources });
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [categoria, setCategoria] = useState("");
  const [filtro, setFiltro] = useState("governo");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-sources"] });
    qc.invalidateQueries({ queryKey: ["coleta-sources"] });
    qc.invalidateQueries({ queryKey: ["coleta-fontes-unificadas"] });
  };

  const ehColeta = platform === "youtube";
  // Prévia da normalização do subsistema de coleta (YouTube aceita @canal ou URL).
  const previa = ehColeta && handle.trim() ? normalizeHandle(platform as Platform, handle) : null;

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) refresh();
  }

  function adicionar() {
    if (!handle.trim()) return;
    if (ehColeta) {
      run(
        () => addColetaSource(platform as Platform, handle, categoria),
        "✔ Fonte cadastrada (pausada — ative para começar a coletar)"
      );
    } else {
      run(() => addSource(platform, handle, categoria || handle.trim(), filtro), "✔ Adicionada");
    }
    setHandle("");
    setCategoria("");
  }

  // Fontes do subsistema de coleta que não são Instagram (as de Instagram do
  // pipeline atual já aparecem na lista principal abaixo).
  const coletaNaoIg = (coletaSources ?? []).filter((s: ColetaSource) => s.platform !== "instagram");

  return (
    <Card title="Fontes monitoradas">
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
          <option value="facebook" disabled>Facebook (em breve)</option>
          <option value="tiktok" disabled>TikTok (em breve)</option>
          <option value="x" disabled>X / Twitter (em breve)</option>
        </select>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && adicionar()}
          placeholder={ehColeta ? "@canal ou URL do canal" : "@perfil"}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder={ehColeta ? "Nome de exibição (opcional)" : "Categoria (ex: Prefeito, Imprensa local…)"}
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        {!ehColeta && (
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {FILTRO_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
      {previa && (
        <p className="mt-2 text-xs text-txt-3">
          {previa.error
            ? <span className="text-risk-crit">{previa.error}</span>
            : <>Será salva como <code className="rounded bg-bg-2 px-1 py-0.5 text-txt-2">{platform}/{previa.handle}</code></>}
        </p>
      )}
      <p className="mt-2 text-xs text-txt-3">
        {ehColeta
          ? "Fonte de YouTube nasce pausada — nada é coletado até você ativá-la na lista abaixo."
          : "Um perfil de Instagram salvo aqui entra na próxima execução do ÁGORA automaticamente (o pipeline lê esta lista a cada rodada — não precisa reconfigurar nada na Apify manualmente)."}
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
                className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold uppercase"
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
        {coletaNaoIg.map((s: ColetaSource) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold uppercase"
                style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}
              >
                {s.platform}
              </span>
              <span className={s.active ? "text-txt-1" : "text-txt-3"}>
                <span className="font-semibold">{s.handle}</span>
                {s.label && <span className="ml-1 text-txt-3">· {s.label}</span>}
                {!s.active && <span className="ml-2 text-[12px] uppercase tracking-wide text-txt-3">pausada</span>}
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
        {sources?.length === 0 && coletaNaoIg.length === 0 && (
          <p className="text-sm text-txt-3">Nenhuma fonte cadastrada.</p>
        )}
      </div>
    </Card>
  );
}

/**
 * Perfis monitorados. Saiu da Configuração (admin-only) para a barra lateral
 * na revisão de 25/07 — qualquer usuário do tenant cadastra e pausa fontes
 * (policy liberada na migration 007). Instagram alimenta o pipeline atual
 * (monitored_sources); YouTube entra no subsistema de coleta (sources).
 */
export function FontesPage() {
  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Fontes</h1>
        <p className="text-base text-txt-2">
          Perfis que o radar acompanha para coletar posts e comentários
        </p>
      </div>
      <SourcesSection />
    </div>
  );
}
