import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSources, addSource, toggleSource, deleteSource,
  fetchKeywords, addKeyword, toggleKeyword, deleteKeyword, type Keyword,
} from "@/lib/admin";
import { ConfirmaModal } from "@/components/ConfirmaModal";
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
                {coletaNaoIg.length} {coletaNaoIg.length === 1 ? "fonte" : "fontes"}
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
 * Palavras-chave do filtro de relevância. Era a página "Relevância" da barra
 * lateral e passou a ser uma aba DESTA tela em 06/08/26 (pedido do cliente):
 * as duas respondem à mesma pergunta — o que o radar olha —, uma pelo perfil e
 * outra pela palavra, e ficavam a dois itens de distância no menu.
 *
 * A regra do produto segue intocada: a lista é do CLIENTE. O sistema nunca
 * adiciona, remove nem "melhora" palavra por conta própria; é esta lista que
 * decide quais posts entram na análise (ver agora.py::_motivo_relevancia).
 *
 * Desenho da prévia 3 de 04/08: NUVEM DE PÍLULAS — todas as palavras num
 * relance, ativa em laranja cheio (tinta escura, a regra da marca), desativada
 * apagada com traço. Clicar na pílula ativa/desativa; o ✕ remove com o
 * ConfirmaModal (window.confirm continua banido).
 */
function KeywordsSection() {
  const qc = useQueryClient();
  const { data: keywords } = useQuery({ queryKey: ["admin-keywords"], queryFn: fetchKeywords });
  const [novo, setNovo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [removendo, setRemovendo] = useState<Keyword | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-keywords"] });

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) refresh();
  }

  const total = keywords?.length ?? 0;
  const ativas = (keywords ?? []).filter((k) => k.active).length;

  return (
    <Card title={`Palavras-chave do filtro de relevância · ${total} palavra${total === 1 ? "" : "s"} · ${ativas} ativa${ativas === 1 ? "" : "s"}`}>
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
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90"
        >
          Adicionar
        </button>
      </div>
      <div className="my-3"><Feedback msg={msg} /></div>
      <div className="flex flex-wrap gap-2.5">
        {(keywords ?? []).map((k) => (
          <span
            key={k.id}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-bold transition ${
              k.active
                ? "bg-brand text-brand-ink"
                : "border border-line bg-bg-2 text-txt-3 line-through"
            }`}
            style={k.active ? { boxShadow: "0 6px 16px var(--brand-glow, rgba(98,194,202,0.22))" } : undefined}
          >
            <button
              onClick={() => run(() => toggleKeyword(k.id, !k.active), k.active ? "✔ Desativada" : "✔ Ativada")}
              className="cursor-pointer"
              title={k.active ? "Clique para desativar (a palavra sai do filtro)" : "Clique para reativar"}
            >
              {k.keyword}
            </button>
            <button
              onClick={() => setRemovendo(k)}
              className="cursor-pointer font-extrabold opacity-60 transition hover:opacity-100"
              aria-label={`Remover a palavra ${k.keyword}`}
            >
              ✕
            </button>
          </span>
        ))}
        {total === 0 && <p className="text-sm text-txt-3">Nenhuma palavra-chave cadastrada.</p>}
      </div>
      {removendo && (
        <ConfirmaModal
          titulo={`Remover "${removendo.keyword}"?`}
          mensagem={
            <>
              A palavra sai do filtro de relevância na próxima execução do ÁGORA: posts que só
              casavam com ela deixam de entrar na análise. Para uma pausa temporária, prefira
              desativar (clique na pílula) — o cadastro fica guardado.
            </>
          }
          onConfirmar={() => {
            run(() => deleteKeyword(removendo.id), "✔ Removida");
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}
    </Card>
  );
}

type Aba = "perfis" | "relevancia";

const ABAS: { id: Aba; label: string }[] = [
  { id: "perfis", label: "Perfis monitorados" },
  { id: "relevancia", label: "Relevância" },
];

/**
 * Fontes. Saiu da Configuração (admin-only) para a barra lateral na revisão de
 * 25/07 — qualquer usuário do tenant cadastra e pausa fontes (policy liberada
 * na migration 007). Instagram alimenta o pipeline atual (monitored_sources);
 * YouTube entra no subsistema de coleta (sources).
 *
 * Desde 06/08/26 a tela tem DUAS abas, com a Relevância vindo da barra lateral
 * para cá: as duas definem o que o radar olha (uma por perfil, outra por
 * palavra) e o item próprio no menu saiu junto. Abas, e não os dois cards
 * empilhados, porque cada lista é longa o suficiente para empurrar a outra
 * para fora da dobra — o mesmo padrão da Configuração.
 */
export function FontesPage() {
  const [aba, setAba] = useState<Aba>("perfis");

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[27px] font-semibold leading-tight tracking-tight">Fontes</h1>
        <p className="text-base text-txt-2">
          Perfis que o radar acompanha e palavras que decidem o que entra na análise
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg-1 p-1">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              aba === a.id ? "bg-brand text-brand-ink" : "text-txt-2 hover:bg-bg-2 hover:text-txt-1"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === "perfis" ? <SourcesSection /> : <KeywordsSection />}
    </div>
  );
}
