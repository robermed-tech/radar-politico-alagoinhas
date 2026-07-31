import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchKeywords, addKeyword, toggleKeyword, deleteKeyword } from "@/lib/admin";
import { Card, Feedback } from "@/components/FormCard";

function KeywordsSection() {
  const qc = useQueryClient();
  const { data: keywords } = useQuery({ queryKey: ["admin-keywords"], queryFn: fetchKeywords });
  const [novo, setNovo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-keywords"] });

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) refresh();
  }

  return (
    <Card title="Palavras-chave do filtro de relevância">
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
      <div className="space-y-1.5">
        {(keywords ?? []).map((k) => (
          <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
            <span className={k.active ? "text-txt-1" : "text-txt-3 line-through"}>{k.keyword}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => run(() => toggleKeyword(k.id, !k.active), "✔ Atualizada")}
                className="text-xs font-semibold text-txt-3 hover:text-txt-1"
              >
                {k.active ? "Desativar" : "Ativar"}
              </button>
              <button
                onClick={() => run(() => deleteKeyword(k.id), "✔ Removida")}
                className="text-xs font-semibold text-risk-crit hover:underline"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {keywords?.length === 0 && <p className="text-sm text-txt-3">Nenhuma palavra-chave cadastrada.</p>}
      </div>
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
