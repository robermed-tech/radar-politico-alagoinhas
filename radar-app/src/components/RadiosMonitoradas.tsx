import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRadios, addRadio, updateRadio, toggleRadio, deleteRadio, validarStream,
  type RadioFonte, type RadioConfig,
} from "@/lib/radio";
import {
  FUNDO_ESCUTA, FUNDO_LARANJA, TINTA_PRETA, TINTA_CLARA, TINTA_CLARA_2,
  FUNDO_LISTA, FUNDO_ITEM, BORDA, SOMBRA, ALTURA_MIN, ALTURA_MAX,
} from "@/components/superficieRadio";

/**
 * Cadastro das rádios monitoradas — card da LINHA DE TOPO da Rádio Escuta
 * (30/07), no lugar onde antes ficavam os quatro indicadores.
 *
 * Ele vivia no rodapé da página, num card claro. O cliente pediu o cadastro no
 * cabeçalho e com o mesmo desenho do "Gravar agora": os dois controles da tela
 * ficam lado a lado, e quem cadastra uma estação vê o botão de gravar sem
 * rolar. A superfície é literalmente a mesma (`superficieRadio.ts`), não uma
 * cópia parecida.
 *
 * Continua vivendo aqui, e não na tela Fontes, porque a Fontes é aberta a
 * qualquer usuário e a Rádio Escuta é admin-only — é a exceção consciente ao
 * "cadastro de fontes unificado numa tela só".
 *
 * Editar é operação de primeira classe (pedido de 30/07): mudar o horário do
 * programa exigia remover a rádio e cadastrar de novo, o que perdia o `peso` e
 * o estado de ativação. O formulário é UM só, e alterna entre cadastrar e
 * editar — dois formulários lado a lado deixariam a dúvida sobre qual está
 * valendo.
 */

const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const DIAS_UTEIS = ["seg", "ter", "qua", "qui", "sex"];

interface Form {
  nome: string;
  stream: string;
  programa: string;
  hora: string;
  duracao: string;
  dias: string[];
}

const VAZIO: Form = {
  nome: "", stream: "", programa: "", hora: "", duracao: "30", dias: DIAS_UTEIS,
};

function doCadastro(r: RadioFonte): Form {
  return {
    nome: r.label ?? "",
    stream: r.handle,
    programa: r.config?.programa ?? "",
    hora: r.config?.hora_inicio ?? "",
    duracao: String(r.config?.duracao_min ?? 30),
    dias: r.config?.dias ?? DIAS_UTEIS,
  };
}

function configDo(f: Form): RadioConfig {
  return {
    programa: f.programa.trim() || undefined,
    hora_inicio: f.hora.trim() || undefined,
    duracao_min: Number(f.duracao) > 0 ? Number(f.duracao) : undefined,
    dias: f.dias.length ? f.dias : undefined,
  };
}

/** Campo de texto sobre o degradê: fundo quase sólido, tinta clara. */
function Campo({
  valor, onChange, placeholder, largura,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  largura?: string;
}) {
  return (
    <input
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-xl px-3 py-2 text-sm outline-none transition placeholder:text-[#94A3B8] focus:border-[#FB923C] ${largura ?? "w-full"}`}
      style={{ background: FUNDO_ITEM, border: BORDA, color: TINTA_CLARA, fontWeight: 600 }}
    />
  );
}

export function RadiosMonitoradas() {
  const qc = useQueryClient();
  const { data: radios = [] } = useQuery({ queryKey: ["radios"], queryFn: fetchRadios });

  const [form, setForm] = useState<Form>(VAZIO);
  /** id da rádio em edição; null = o formulário está cadastrando uma nova. */
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const previa = form.stream.trim() ? validarStream(form.stream) : null;
  const emEdicao = radios.find((r) => r.id === editando) ?? null;

  function set<K extends keyof Form>(chave: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [chave]: valor }));
    setMsg(null);
  }

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    setSalvando(true);
    const err = await fn();
    setSalvando(false);
    setMsg(err ? { ok: false, texto: err } : { ok: true, texto: sucesso });
    if (!err) qc.invalidateQueries({ queryKey: ["radios"] });
    return !err;
  }

  function abrirEdicao(r: RadioFonte) {
    setEditando(r.id);
    setForm(doCadastro(r));
    setMsg(null);
  }

  function cancelar() {
    setEditando(null);
    setForm(VAZIO);
    setMsg(null);
  }

  async function salvar() {
    if (salvando) return;
    if (editando) {
      // O `peso` viaja junto: ele não tem campo na tela, e gravar o config sem
      // ele apagaria a audiência da estação a cada edição de horário.
      const cfg = { ...configDo(form), peso: emEdicao?.config?.peso ?? 1 };
      const ok = await run(() => updateRadio(editando, form.stream, form.nome, cfg), "✔ Cadastro atualizado");
      if (ok) setEditando(null);
      return;
    }
    if (!form.stream.trim()) return;
    const ok = await run(
      () => addRadio(form.stream, form.nome, configDo(form)),
      "✔ Rádio cadastrada (pausada — ative para começar a captar)",
    );
    if (ok) setForm(VAZIO);
  }

  async function remover(r: RadioFonte) {
    const nome = r.label ?? r.handle;
    if (!window.confirm(`Remover ${nome} do monitoramento? As pautas já captadas continuam na tela.`)) return;
    const ok = await run(() => deleteRadio(r.id), "✔ Removida");
    if (ok && editando === r.id) cancelar();
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-[28px] p-5"
      style={{ background: FUNDO_ESCUTA, minHeight: ALTURA_MIN, maxHeight: ALTURA_MAX, boxShadow: SOMBRA }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[13px] uppercase tracking-[0.14em]"
          style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
        >
          Rádios monitoradas
        </div>
        <div className="text-[13px]" style={{ color: TINTA_CLARA_2, fontWeight: 600 }}>
          {editando
            ? `editando ${emEdicao?.label ?? "estação"}`
            : `${radios.length} cadastrada(s) · ${radios.filter((r) => r.active).length} ativa(s)`}
        </div>
      </div>

      {/* Formulário em largura cheia no topo e lista abaixo, e não duas
          colunas: os campos que mais importam são a URL do stream e o nome, e
          numa metade de card eles ficariam estreitos demais para se conferir um
          endereço colado. Assim o formulário fica raso, e o que sobra de altura
          é da lista. */}
      <div className="mt-3 shrink-0 rounded-2xl p-3" style={{ background: FUNDO_LISTA, border: BORDA }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Campo valor={form.nome} onChange={(v) => set("nome", v)} placeholder="Nome da estação (ex: 93 FM Bahia)" />
          <Campo valor={form.stream} onChange={(v) => set("stream", v)} placeholder="URL do stream (.m3u8, .mp3, /stream…)" />
          <Campo valor={form.programa} onChange={(v) => set("programa", v)} placeholder="Programa (opcional)" />
          <div className="flex gap-2">
            <Campo valor={form.hora} onChange={(v) => set("hora", v)} placeholder="Início 07:00" />
            <Campo valor={form.duracao} onChange={(v) => set("duracao", v)} placeholder="min" largura="tnum w-20 shrink-0" />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {DIAS_SEMANA.map((d) => {
            const ativo = form.dias.includes(d);
            return (
              <button
                key={d}
                onClick={() => set("dias", ativo ? form.dias.filter((x) => x !== d) : [...form.dias, d])}
                aria-pressed={ativo}
                title={`Captar às ${d}`}
                className="rounded-lg px-2.5 py-1 text-[13px] transition"
                style={
                  ativo
                    ? { background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }
                    : { background: FUNDO_ITEM, color: TINTA_CLARA, fontWeight: 700, border: BORDA }
                }
              >
                {d}
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-1.5">
            {editando && (
              <button
                onClick={cancelar}
                className="rounded-full px-4 py-1.5 text-[13px] transition"
                style={{ background: FUNDO_ITEM, color: TINTA_CLARA, fontWeight: 700, border: BORDA }}
              >
                Cancelar
              </button>
            )}
            <button
              onClick={salvar}
              disabled={salvando}
              className="rounded-full px-5 py-1.5 text-[13px] uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }}
            >
              {salvando ? "Salvando…" : editando ? "Salvar" : "Adicionar"}
            </button>
          </div>
        </div>

        {/* Aviso de stream, resultado da ação e nota de funcionamento dividem a
            mesma faixa: o card tem altura de linha de topo, e três parágrafos
            fixos o esticariam para fora dela. */}
        <p
          role={msg ? "status" : undefined}
          className="mt-2 text-[12px] leading-snug"
          style={{
            color: previa?.error || (msg && !msg.ok) ? "#FCA5A5"
              : previa?.aviso ? "#FED7AA"
              : msg ? "#86EFAC"
              : TINTA_CLARA_2,
            fontWeight: previa || msg ? 600 : 500,
          }}
        >
          {previa?.error || previa?.aviso || msg?.texto ||
            "Captação ao vivo, só na faixa horária cadastrada: fora dela nada é gravado, para não captar bloco musical e publicidade. Rádio nova nasce pausada."}
        </p>
      </div>

      {/* Lista das estações. Rola por dentro para o card não crescer com o
          número de rádios, igual à caixa de escolha do "Gravar agora". */}
      <div
        className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl p-2"
        style={{ background: FUNDO_LISTA, border: BORDA }}
      >
        {radios.length === 0 ? (
          <p className="p-2 text-[13px] leading-relaxed" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
            Nenhuma rádio cadastrada. Informe a estação e o horário do programa acima para começar
            a captar.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {radios.map((r) => {
              const sel = editando === r.id;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: FUNDO_ITEM,
                    border: BORDA,
                    // Anel, e não mudança de fundo: o item em edição precisa
                    // continuar legível enquanto o formulário acima o mostra.
                    boxShadow: sel ? "0 0 0 2px #FB923C" : undefined,
                  }}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: r.active ? "#22C55E" : "#94A3B8" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm" style={{ color: TINTA_CLARA, fontWeight: 700 }}>
                        {r.label ?? r.handle}
                      </span>
                      {!r.active && (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[12px] uppercase"
                          style={{ background: "rgba(2,6,23,0.88)", color: TINTA_CLARA_2, fontWeight: 700 }}
                        >
                          pausada
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[12px]" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
                      {r.config?.programa ? `${r.config.programa} · ` : ""}
                      {r.config?.hora_inicio
                        ? `${r.config.hora_inicio} (${r.config.duracao_min ?? 30} min)`
                        : "sem horário, capta sempre"}
                      {r.config?.dias?.length ? ` · ${r.config.dias.join(" ")}` : ""}
                    </div>
                    <div className="truncate text-[12px]" style={{ color: "#94A3B8", fontWeight: 500 }} title={r.handle}>
                      {r.handle}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => (sel ? cancelar() : abrirEdicao(r))}
                      className="rounded-lg px-2.5 py-1 text-[13px] transition"
                      style={
                        sel
                          ? { background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }
                          : { background: "rgba(2,6,23,0.88)", color: TINTA_CLARA, fontWeight: 700, border: BORDA }
                      }
                      title={`Editar o cadastro de ${r.label ?? r.handle}`}
                    >
                      {sel ? "Editando" : "Editar"}
                    </button>
                    <button
                      onClick={() => run(() => toggleRadio(r.id, !r.active), r.active ? "✔ Pausada" : "✔ Ativada")}
                      className="rounded-lg px-2.5 py-1 text-[13px] transition"
                      style={{ background: "rgba(2,6,23,0.88)", color: TINTA_CLARA, fontWeight: 700, border: BORDA }}
                      title={r.active ? "Parar de captar no horário do programa" : "Voltar a captar no horário do programa"}
                    >
                      {r.active ? "Pausar" : "Ativar"}
                    </button>
                    <button
                      onClick={() => remover(r)}
                      className="rounded-lg px-2.5 py-1 text-[13px] transition"
                      style={{ background: "rgba(2,6,23,0.88)", color: "#FCA5A5", fontWeight: 700, border: BORDA }}
                    >
                      Remover
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
