import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRadios, addRadio, updateRadio, toggleRadio, deleteRadio, validarStream,
  programasDe, type RadioFonte, type RadioConfig, type ProgramaRadio,
} from "@/lib/radio";
import {
  FUNDO_ESCUTA, FUNDO_LARANJA, TINTA_PRETA, TINTA_CLARA, TINTA_CLARA_2,
  FUNDO_LISTA, FUNDO_ITEM, BORDA, SOMBRA, ALTURA_MIN, ALTURA_MAX,
} from "@/components/superficieRadio";
import { ConfirmaModal } from "@/components/ConfirmaModal";
import { LedVivo } from "@/components/SinalVivo";

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

/** Um programa no formulário. Cada um é uma janela de captação própria:
 * a mesma rádio tem vários programas em horários diferentes (03/08). */
interface ProgForm {
  nome: string;
  hora: string;
  duracao: string;
  dias: string[];
}

interface Form {
  nome: string;
  stream: string;
  programas: ProgForm[];
}

const PROG_VAZIO: ProgForm = { nome: "", hora: "", duracao: "30", dias: DIAS_UTEIS };
const VAZIO: Form = { nome: "", stream: "", programas: [PROG_VAZIO] };

function doCadastro(r: RadioFonte): Form {
  const progs = programasDe(r.config).map((p) => ({
    nome: p.nome ?? "",
    hora: p.hora_inicio ?? "",
    duracao: String(p.duracao_min ?? 30),
    // Sem `dias` no banco = roda TODOS os dias (é assim que o coletor lê).
    // Carregar como seg-sex mudaria o significado em silêncio ao salvar.
    dias: p.dias ?? DIAS_SEMANA,
  }));
  return {
    nome: r.label ?? "",
    stream: r.handle,
    programas: progs.length ? progs : [PROG_VAZIO],
  };
}

function configDo(f: Form): RadioConfig {
  // Grava sempre no formato NOVO (grade de programas). Linha totalmente vazia
  // é descartada; programa sem horário é mantido com o nome (a estação fica
  // "só grava sob demanda", e o coletor ignora janelas sem hora).
  const programas: ProgramaRadio[] = f.programas
    .filter((p) => p.nome.trim() || p.hora.trim())
    .map((p) => ({
      nome: p.nome.trim() || undefined,
      hora_inicio: p.hora.trim() || undefined,
      duracao_min: Number(p.duracao) > 0 ? Number(p.duracao) : undefined,
      dias: p.dias.length ? p.dias : undefined,
    }));
  return { programas };
}

/** Rótulo curto de um programa na lista: "Manhã Total · 07:00 (60 min) · seg qua". */
function rotuloPrograma(p: ProgramaRadio): string {
  const partes: string[] = [];
  if (p.nome) partes.push(p.nome);
  partes.push(p.hora_inicio ? `${p.hora_inicio} (${p.duracao_min ?? 30} min)` : "sem horário · só grava sob demanda");
  if (p.hora_inicio && p.dias?.length && p.dias.length < 7) partes.push(p.dias.join(" "));
  return partes.join(" · ");
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
      className={`rounded-xl px-3 py-2 text-sm outline-none transition placeholder:text-[#94A3B8] focus:border-brand ${largura ?? "w-full"}`}
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

  function setPrograma<K extends keyof ProgForm>(i: number, chave: K, valor: ProgForm[K]) {
    setForm((f) => ({
      ...f,
      programas: f.programas.map((p, j) => (j === i ? { ...p, [chave]: valor } : p)),
    }));
    setMsg(null);
  }

  function adicionarPrograma() {
    setForm((f) => ({ ...f, programas: [...f.programas, PROG_VAZIO] }));
  }

  function removerPrograma(i: number) {
    // A grade nunca fica sem linha: remover a última limpa em vez de sumir
    // com ela, senão o formulário perde o lugar de digitar o próximo horário.
    setForm((f) => ({
      ...f,
      programas: f.programas.length > 1
        ? f.programas.filter((_, j) => j !== i)
        : [PROG_VAZIO],
    }));
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

  // Pop-up de confirmação na linha visual do painel (03/08), no lugar do
  // window.confirm nativo, que era o único box fora do padrão.
  const [removendo, setRemovendo] = useState<RadioFonte | null>(null);

  async function remover(r: RadioFonte) {
    setRemovendo(null);
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
        </div>

        {/* Grade de programas: uma mesma rádio tem vários programas em
            horários diferentes, e cada linha aqui é uma janela de captação
            própria (03/08). O bloco rola por dentro a partir do terceiro
            programa, para a grade não engolir a lista de estações abaixo. */}
        <div className="mt-2 max-h-[190px] space-y-1.5 overflow-y-auto">
          {form.programas.map((p, i) => (
            <div key={i} className="rounded-xl p-2" style={{ background: FUNDO_ITEM, border: BORDA }}>
              <div className="flex gap-2">
                <Campo valor={p.nome} onChange={(v) => setPrograma(i, "nome", v)} placeholder={`Programa ${i + 1} (opcional)`} />
                <Campo valor={p.hora} onChange={(v) => setPrograma(i, "hora", v)} placeholder="07:00" largura="tnum w-24 shrink-0" />
                <Campo valor={p.duracao} onChange={(v) => setPrograma(i, "duracao", v)} placeholder="min" largura="tnum w-16 shrink-0" />
                <button
                  onClick={() => removerPrograma(i)}
                  aria-label={`Remover programa ${i + 1}`}
                  title="Remover este programa da grade"
                  className="shrink-0 self-center rounded-lg px-2 py-1 text-[13px] transition hover:opacity-80"
                  style={{ background: "rgba(2,6,23,0.88)", color: "#FCA5A5", fontWeight: 700, border: BORDA }}
                >
                  ✕
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {DIAS_SEMANA.map((d) => {
                  const ativo = p.dias.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() =>
                        setPrograma(i, "dias", ativo ? p.dias.filter((x) => x !== d) : [...p.dias, d])
                      }
                      aria-pressed={ativo}
                      title={`Captar ${p.nome || `programa ${i + 1}`} às ${d}`}
                      className="rounded-lg px-2 py-0.5 text-[12px] transition"
                      style={
                        ativo
                          ? { background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }
                          : { background: "rgba(2,6,23,0.6)", color: TINTA_CLARA, fontWeight: 700, border: BORDA }
                      }
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            onClick={adicionarPrograma}
            className="rounded-full px-3.5 py-1.5 text-[13px] transition hover:opacity-90"
            style={{ background: FUNDO_ITEM, color: TINTA_CLARA, fontWeight: 700, border: BORDA }}
          >
            + Programa
          </button>

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
                    boxShadow: sel ? "0 0 0 2px var(--brand)" : undefined,
                  }}
                >
                  {/* LED com halo pulsante quando a estação está ativa (onda 2
                      de 03/08, o "card pulsando" do protótipo). Laranja da
                      marca, não mais verde: verde é exclusivo de sentimento. */}
                  <LedVivo ligado={r.active} />
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
                    {/* Um programa por linha: a grade inteira da estação é o
                        dado que diz QUANDO ela grava sozinha. */}
                    {programasDe(r.config).length === 0 ? (
                      <div className="truncate text-[12px]" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
                        sem horário · só grava sob demanda
                      </div>
                    ) : (
                      programasDe(r.config).map((p, pi) => (
                        <div key={pi} className="truncate text-[12px]" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
                          {rotuloPrograma(p)}
                        </div>
                      ))
                    )}
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
                      onClick={() => setRemovendo(r)}
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

      {removendo && (
        <ConfirmaModal
          titulo={`Remover ${removendo.label ?? removendo.handle}?`}
          mensagem="A estação sai do monitoramento e da captação automática. As pautas já captadas continuam na tela."
          rotuloConfirmar="Remover estação"
          onConfirmar={() => void remover(removendo)}
          onCancelar={() => setRemovendo(null)}
        />
      )}
    </div>
  );
}
