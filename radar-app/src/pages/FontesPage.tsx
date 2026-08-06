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

/* Prévia aprovada em 04/08: os chips coloridos de categoria saíram — o antigo
   FILTRO_COLOR pintava GOVERNO de verde e OPOSIÇÃO de vermelho, e
   verde/vermelho são reservados a sentimento (a mesma regra que já tirou a
   cor do seletor de perfis). A categoria agora é o CABEÇALHO do grupo em que
   a fonte aparece, não um selo pintado em cada linha. */

/** LED de estado da fonte — o mesmo sinal da Rádio Escuta: laranja acesa,
 *  cinza apagada. */
function LedFonte({ ativa }: { ativa: boolean }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={
        ativa
          ? { background: "var(--brand)", boxShadow: "0 0 8px var(--brand)" }
          : { background: "var(--txt3)", opacity: 0.5 }
      }
      aria-hidden
    />
  );
}

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
  //
  // Rádio também fica de fora: ela vive na mesma tabela `sources`, mas o
  // cadastro dela mora na tela Escuta do Rádio, que é admin-only. Esta página é
  // aberta a qualquer usuário do tenant, e sem este filtro a estação apareceria
  // aqui — para o admin, ao menos, já que o RLS da migration 011 esconde as
  // linhas de rádio de quem não é admin.
  const coletaNaoIg = (coletaSources ?? []).filter(
    (s: ColetaSource) => s.platform !== "instagram" && s.platform !== "radio"
  );

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
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90"
        >
          Adicionar
        </button>
        <Feedback msg={msg} />
      </div>
      {/* Lista agrupada por categoria (prévia de 04/08): acha-se o perfil
          pelo grupo, e o desequilíbrio entre categorias fica visível na
          própria contagem do cabeçalho. */}
      <div className="mt-4 space-y-4">
        {FILTRO_OPTS.map((g) => {
          const doGrupo = (sources ?? []).filter((s) => s.filtro === g.value);
          if (doGrupo.length === 0) return null;
          const ativas = doGrupo.filter((s) => s.active).length;
          return (
            <div key={g.value}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="section-label">{g.label}</span>
                <span className="text-xs font-semibold text-txt-3">
                  {doGrupo.length} {doGrupo.length === 1 ? "perfil" : "perfis"} · {ativas} {ativas === 1 ? "ativo" : "ativos"}
                </span>
              </div>
              <div className="space-y-1.5">
                {doGrupo.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <LedFonte ativa={s.active} />
                      <span className={s.active ? "text-txt-1" : "text-txt-3"}>
                        <span className="font-bold">@{s.handle}</span>
                        <span className="ml-1.5 text-txt-3">{s.platform}</span>
                        {s.categoria && s.categoria !== s.handle && (
                          <span className="text-txt-3"> · {s.categoria}</span>
                        )}
                        {!s.active && <span className="ml-2 text-[12px] uppercase tracking-wide text-txt-3">desativada</span>}
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
                        className="text-xs font-semibold hover:underline"
                        style={{ color: "var(--sent-ink-neg)" }}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Fonte com filtro fora das três categorias não pode sumir da tela
            por causa do agrupamento — cai num grupo "Outros". */}
        {(() => {
          const conhecidos = new Set(FILTRO_OPTS.map((o) => o.value));
          const outros = (sources ?? []).filter((s) => !conhecidos.has(s.filtro));
          if (outros.length === 0) return null;
          return (
            <div>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="section-label">Outros</span>
                <span className="text-xs font-semibold text-txt-3">{outros.length} {outros.length === 1 ? "perfil" : "perfis"}</span>
              </div>
              <div className="space-y-1.5">
                {outros.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <LedFonte ativa={s.active} />
                      <span className={s.active ? "text-txt-1" : "text-txt-3"}>
                        <span className="font-bold">@{s.handle}</span>
                        <span className="ml-1.5 text-txt-3">{s.platform} · {s.filtro}</span>
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
                        className="text-xs font-semibold hover:underline"
                        style={{ color: "var(--sent-ink-neg)" }}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {coletaNaoIg.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="section-label">Outras plataformas</span>
              <span className="text-xs font-semibold text-txt-3">
                {coletaNaoIg.length} fonte(s)
              </span>
            </div>
            <div className="space-y-1.5">
              {coletaNaoIg.map((s: ColetaSource) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <LedFonte ativa={s.active} />
                    <span className={s.active ? "text-txt-1" : "text-txt-3"}>
                      <span className="font-bold">{s.handle}</span>
                      <span className="ml-1.5 text-txt-3">{s.platform}</span>
                      {s.label && <span className="text-txt-3"> · {s.label}</span>}
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
                      className="text-xs font-semibold hover:underline"
                      style={{ color: "var(--sent-ink-neg)" }}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
