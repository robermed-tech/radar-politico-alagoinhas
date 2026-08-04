import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchKeywords, addKeyword, toggleKeyword, deleteKeyword, type Keyword } from "@/lib/admin";
import { Card, Feedback } from "@/components/FormCard";
import { ConfirmaModal } from "@/components/ConfirmaModal";

/**
 * Prévia 3 de 04/08: a lista de linhas virou uma NUVEM DE PÍLULAS — todas as
 * palavras num relance, ativa em laranja cheio (tinta escura, a regra da
 * marca), desativada apagada com traço. Clicar na pílula ativa/desativa; o ✕
 * remove com o ConfirmaModal (window.confirm continua banido). A regra do
 * produto segue intocada: a lista é do CLIENTE — o sistema nunca adiciona nem
 * "melhora" palavra por conta própria.
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
            style={k.active ? { boxShadow: "0 6px 16px var(--brand-glow, rgba(247,150,65,0.22))" } : undefined}
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

/**
 * Palavras-chave do filtro de relevância. Saiu da Configuração (admin-only)
 * para a barra lateral na revisão de 25/07: qualquer usuário do tenant
 * cadastra e desativa termos (a policy de escrita foi liberada na migration
 * 007). É esta lista que decide quais posts entram na análise — ver
 * agora.py::_motivo_relevancia.
 */
export function RelevanciaPage() {
  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Relevância</h1>
        <p className="text-base text-txt-2">
          Palavras que o radar procura nos posts para decidir o que entra na análise
        </p>
      </div>
      <KeywordsSection />
    </div>
  );
}
