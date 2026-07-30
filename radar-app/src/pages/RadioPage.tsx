/**
 * Rádio Escuta — seção admin-only (chamava-se "Escuta do Rádio" até 30/07).
 *
 * Mostra o que cada rádio cadastrada debateu na janela, quais assuntos
 * interessam ao prefeito e à gestão (e por quê), e permite encaminhar a pauta ao
 * secretário pelo mesmo box do dashboard.
 *
 * Três decisões de leitura que valem registro, porque a tela mentiria sem elas:
 *
 * 1. "Não captada" ≠ "sem assunto". Estação pode falhar a gravação (a Rádio Boa
 *    falhou no primeiro teste enquanto três gravaram). Falha aparece como falha,
 *    e nunca como silêncio da estação.
 * 2. A rádio NÃO entra no IAD nem no clima. Meia hora de locutor é um formador
 *    de opinião, não meia hora de opinião popular; somar ao IAD deixaria um
 *    programa fabricar tempestade. Aqui o placar de tom é da RÁDIO, apresentado
 *    como pressão da mídia, e a fala de ouvinte é destacada à parte.
 * 3. Citação é transcrição automática, com instante para conferir no áudio.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCapturas, fetchPautas, fetchRadios, addRadio, toggleRadio, deleteRadio,
  validarStream, resumirPorEstacao, cruzarTemas, pautasCoordenadas, placarTom,
  fmtInstante, CONFIANCA_MIN_RADIO,
  type RadioPauta, type EstacaoResumo,
} from "@/lib/radio";
import { fetchRadar, filtrarPorPeriodo } from "@/lib/data";
import { PeriodoFilter, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { AlertaRadio } from "@/components/AlertaRadio";
import { AntenaStatusColumn } from "@/components/AntenaSinal";
import { ClipeCitacao } from "@/components/ClipeCitacao";
import { GravarAgora } from "@/components/GravarAgora";
import { Card, Feedback } from "@/components/FormCard";
import { labelBairro } from "@/lib/format";
import { corTema } from "@/lib/temaColors";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
};
function labelTema(t: string | null): string {
  if (!t) return "Sem tema";
  return TEMA_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

const TOM_COR: Record<string, string> = {
  critico: "#EF4444",
  favoravel: "#16A34A",
  neutro: "#94A3B8",
  nao_classificado: "#64748B",
};
const TOM_LABEL: Record<string, string> = {
  critico: "crítica à gestão",
  favoravel: "elogio à gestão",
  neutro: "sem juízo sobre a gestão",
  nao_classificado: "tom não medido",
};

const VOZ_LABEL: Record<string, string> = {
  locutor: "locutor", ouvinte: "ouvinte",
  entrevistado: "entrevistado", reportagem: "reportagem",
};

const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

function Kpi({ label, valor, hint }: { label: string; valor: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="section-label">{label}</div>
      <div className="mt-1 text-[32px] font-extrabold leading-none text-txt-1">{valor}</div>
      {hint && <div className="mt-1 text-xs text-txt-3">{hint}</div>}
    </div>
  );
}

/** Uma pauta na lista da estação. */
function PautaItem({ p }: { p: RadioPauta }) {
  const baixaConf = p.confianca < CONFIANCA_MIN_RADIO;
  return (
    <div className="rounded-xl border border-line bg-bg-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {p.interesse_gestao && (
              <span
                className="rounded px-1.5 py-0.5 text-[12px] font-bold uppercase"
                style={{ background: "rgba(249,115,22,0.14)", color: "#C2410C" }}
              >
                interessa à gestão
              </span>
            )}
            {p.tema && (
              <span
                className="rounded px-1.5 py-0.5 text-[12px] font-bold"
                style={{ background: `${corTema(p.tema)}22`, color: corTema(p.tema) }}
              >
                {labelTema(p.tema)}
              </span>
            )}
            <span className="text-[12px] font-semibold" style={{ color: TOM_COR[p.tom_sobre_gestao] }}>
              {TOM_LABEL[p.tom_sobre_gestao]}
            </span>
            {p.voz && (
              <span className="text-[12px] text-txt-3">fala de {VOZ_LABEL[p.voz] ?? p.voz}</span>
            )}
            {baixaConf && (
              <span className="text-[12px] text-txt-3" title="Confiança abaixo do piso: conta no total, não conta como crítica nem como elogio">
                confiança baixa
              </span>
            )}
          </div>
          <div className="mt-1 text-base font-bold text-txt-1">{p.assunto}</div>
        </div>
        {p.interesse_gestao && <AlertaRadio pauta={p} />}
      </div>

      {p.resumo && <p className="mt-1.5 text-sm leading-relaxed text-txt-2">{p.resumo}</p>}

      {p.motivo_interesse && (
        <p className="mt-1.5 text-sm leading-relaxed text-txt-1">
          <span className="font-bold">Por que interessa: </span>
          {p.motivo_interesse}
        </p>
      )}

      {p.citacao && (
        <div className="mt-2 border-l-2 pl-2.5" style={{ borderColor: "rgba(148,163,184,0.5)" }}>
          <p className="text-sm italic leading-relaxed text-txt-2">“{p.citacao}”</p>
          {/* O áudio fica na MESMA caixa da citação, colado nela: é a frase
              que ele confere, e o aviso de "transcrição automática" ao lado é
              justamente o motivo de existir um botão de ouvir. */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ClipeCitacao caminho={p.audio_clip} />
            <span className="text-[12px] text-txt-3">
              aos {fmtInstante(p.ts_inicio)} da captação · transcrição automática
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-3 text-[13px] text-txt-3">
        {p.localidade && <span>📍 {labelBairro(p.localidade)}</span>}
        {p.pedido && <span>📌 {p.pedido}</span>}
      </div>
    </div>
  );
}

function CardEstacao({ r }: { r: EstacaoResumo }) {
  const [aberto, setAberto] = useState(true);
  const naoCaptada = r.capturas > 0 && r.falhas === r.capturas;

  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl font-extrabold text-txt-1">{r.estacao}</div>
          <div className="text-sm text-txt-2">
            {r.programa ? `${r.programa} · ` : ""}
            {r.capturas} captação(ões){r.minutos > 0 ? `, ${Math.round(r.minutos)} min` : ""}
            {r.ultima && ` · última em ${new Date(r.ultima.inicio_ts).toLocaleString("pt-BR", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}`}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-bold" style={{ color: TOM_COR.critico }}>{r.placar.critico} crítica(s)</span>
          <span className="font-bold" style={{ color: TOM_COR.favoravel }}>{r.placar.favoravel} elogio(s)</span>
          <span className="text-txt-3">{r.placar.neutro} neutra(s)</span>
        </div>
      </div>

      {/* Falha de captura é dita como falha. Sem isto a estação apareceria
          silenciosa, como se nada tivesse sido falado no ar. */}
      {r.falhas > 0 && (
        <p className="mt-2 rounded-lg px-3 py-2 text-sm font-semibold"
           style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
          {naoCaptada
            ? "Não captada: a gravação do stream falhou. Confira se a URL é o endereço direto do áudio."
            : `${r.falhas} de ${r.capturas} captação(ões) falharam na gravação.`}
        </p>
      )}

      {r.pautas.length === 0 && !naoCaptada && (
        <p className="mt-2 text-sm text-txt-3">
          Captada, e nenhum trecho tratou da prefeitura, do prefeito ou da gestão nesta janela.
        </p>
      )}

      {r.pautas.length > 0 && (
        <>
          <button
            onClick={() => setAberto((v) => !v)}
            className="mt-3 text-sm font-semibold text-brand hover:underline"
          >
            {aberto ? "Ocultar" : `Ver ${r.pautas.length} assunto(s)`}
            {r.deInteresse.length > 0 && ` · ${r.deInteresse.length} de interesse da gestão`}
          </button>
          {aberto && (
            <div className="mt-2 space-y-2">
              {r.pautas.map((p) => <PautaItem key={p.id} p={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Cadastro das rádios. Vive aqui, e não na tela Fontes, porque a Fontes é
 *  aberta a qualquer usuário e esta funcionalidade é do admin. */
function CadastroRadios() {
  const qc = useQueryClient();
  const { data: radios = [] } = useQuery({ queryKey: ["radios"], queryFn: fetchRadios });
  const [stream, setStream] = useState("");
  const [nome, setNome] = useState("");
  const [programa, setPrograma] = useState("");
  const [hora, setHora] = useState("");
  const [duracao, setDuracao] = useState("30");
  const [dias, setDias] = useState<string[]>(["seg", "ter", "qua", "qui", "sex"]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const previa = stream.trim() ? validarStream(stream) : null;

  async function run(fn: () => Promise<string | null>, sucesso: string) {
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: sucesso });
    if (!err) qc.invalidateQueries({ queryKey: ["radios"] });
  }

  function adicionar() {
    if (!stream.trim()) return;
    void run(
      () => addRadio(stream, nome, {
        programa: programa.trim() || undefined,
        hora_inicio: hora.trim() || undefined,
        duracao_min: Number(duracao) > 0 ? Number(duracao) : undefined,
        dias: dias.length ? dias : undefined,
      }),
      "✔ Rádio cadastrada (pausada — ative para começar a captar)"
    ).then(() => { setStream(""); setNome(""); setPrograma(""); });
  }

  return (
    <Card title="Rádios monitoradas">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome da estação (ex: 93 FM Bahia)"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={stream}
          onChange={(e) => setStream(e.target.value)}
          placeholder="URL do stream (.m3u8, .mp3, /stream…)"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={programa}
          onChange={(e) => setPrograma(e.target.value)}
          placeholder="Programa (opcional)"
          className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="flex gap-2">
          <input
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            placeholder="Início 07:00"
            className="w-full rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
            placeholder="min"
            className="w-24 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {DIAS_SEMANA.map((d) => {
          const ativo = dias.includes(d);
          return (
            <button
              key={d}
              onClick={() => setDias((v) => (ativo ? v.filter((x) => x !== d) : [...v, d]))}
              className="rounded-md px-2.5 py-1 text-xs font-semibold transition"
              style={ativo
                ? { background: "var(--brand)", color: "#1A0F02", fontWeight: 700 }
                : { border: "1px solid var(--line)", color: "var(--txt2)" }}
            >
              {d}
            </button>
          );
        })}
      </div>

      {previa?.error && <p className="mt-2 text-xs text-risk-crit">{previa.error}</p>}
      {previa?.aviso && <p className="mt-2 text-xs" style={{ color: "#F59E0B" }}>{previa.aviso}</p>}

      <p className="mt-2 text-xs text-txt-3">
        A captação é ao vivo: o sistema grava no horário do programa e transcreve. Fora da
        faixa horária cadastrada nada é gravado, para não captar bloco musical e publicidade.
        Rádio nova nasce pausada.
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
        {radios.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className={r.active ? "font-semibold text-txt-1" : "text-txt-3"}>
                {r.label ?? r.handle}
              </span>
              {r.config?.programa && <span className="ml-1 text-txt-3">· {r.config.programa}</span>}
              {r.config?.hora_inicio && (
                <span className="ml-1 text-txt-3">
                  · {r.config.hora_inicio} ({r.config.duracao_min ?? 30} min)
                </span>
              )}
              {!r.active && (
                <span className="ml-2 text-[12px] uppercase tracking-wide text-txt-3">pausada</span>
              )}
              <div className="truncate text-[12px] text-txt-3">{r.handle}</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => run(() => toggleRadio(r.id, !r.active), r.active ? "✔ Pausada" : "✔ Ativada")}
                className="text-xs font-semibold text-txt-3 hover:text-txt-1"
              >
                {r.active ? "Pausar" : "Ativar"}
              </button>
              <button
                onClick={() => run(() => deleteRadio(r.id), "✔ Removida")}
                className="text-xs font-semibold text-risk-crit hover:underline"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {radios.length === 0 && (
          <p className="text-sm text-txt-3">
            Nenhuma rádio cadastrada. Cadastre a estação e o horário do programa para começar.
          </p>
        )}
      </div>
    </Card>
  );
}

export function RadioPage() {
  const [dias, setDias] = useState<Dias>(7);

  const { data: capturas = [], isLoading } = useQuery({
    queryKey: ["radio-capturas", dias],
    queryFn: () => fetchCapturas(dias),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: pautas = [] } = useQuery({
    queryKey: ["radio-pautas", dias],
    queryFn: () => fetchPautas(dias),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: radar } = useQuery({
    queryKey: ["radar"], queryFn: fetchRadar, staleTime: 5 * 60 * 1000,
  });

  const estacoes = useMemo(() => resumirPorEstacao(capturas, pautas), [capturas, pautas]);
  const placar = useMemo(() => placarTom(pautas), [pautas]);
  const coordenadas = useMemo(() => pautasCoordenadas(pautas), [pautas]);

  // Temas do Instagram na mesma janela, para o cruzamento.
  const temasIg = useMemo(() => {
    const posts = filtrarPorPeriodo(radar?.data ?? [], dias);
    const by = new Map<string, number>();
    for (const p of posts) {
      if (!p.tema) continue;
      by.set(p.tema, (by.get(p.tema) ?? 0) + 1);
    }
    return [...by.entries()].map(([tema, total]) => ({ tema, total }));
  }, [radar, dias]);

  const cruzamento = useMemo(() => cruzarTemas(pautas, temasIg), [pautas, temasIg]);

  const deInteresse = pautas.filter((p) => p.interesse_gestao);
  const minutos = capturas
    .filter((c) => c.status === "SUCCESS")
    .reduce((acc, c) => acc + (Number(c.duracao_min) || 0), 0);
  const vozOuvinte = pautas.filter((p) => p.voz === "ouvinte");

  // "Captando" é gravação que DEU certo na janela, não rádio cadastrada: uma
  // estação cujo stream falhou continua monitorada e não está captando nada
  // (é a mesma distinção que o card de estação faz entre falha e silêncio).
  const estacoesCaptadas = estacoes.filter((e) => e.capturas > e.falhas).length;
  const captando = estacoesCaptadas > 0;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Rádio Escuta</h1>
          <p className="text-base text-txt-2">
            O que as rádios debateram e o que disso afeta a imagem da gestão · {periodoLabel(dias)}
          </p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} />
      </div>

      {/* Linha de topo: antena à esquerda (mesmo lugar de leitura que o radar
          de coleta ocupa na Estação Meteorológica — primeiro o sinal de que o
          sistema está ouvindo, depois o que ele ouviu), indicadores no meio e,
          à DIREITA, o card quadrado de gravação sob demanda (30/07). Antes ele
          era uma faixa de largura cheia acima de tudo, e empurrava a página
          inteira para baixo por causa de um controle de uso eventual. O
          cadastro das estações continua no card "Rádios monitoradas", lá
          embaixo, intocado. */}
      <div className="grid gap-3 lg:grid-cols-6">
        <div className="lg:col-span-1">
          <AntenaStatusColumn
            ativo={captando}
            legenda={
              captando
                ? `${estacoesCaptadas} estação(ões) no ar`
                : estacoes.length > 0
                  ? "nenhuma gravação nesta janela"
                  : "nenhuma rádio cadastrada"
            }
          />
        </div>
        {/* Os quatro indicadores em 2×2 para caber na coluna do meio e deixar
            a linha com a altura de um card quadrado à direita. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
          <Kpi
            label="Rádios captadas"
            valor={String(estacoesCaptadas)}
            hint={`${estacoes.length} monitorada(s) na janela`}
          />
          <Kpi label="Minutos transcritos" valor={String(Math.round(minutos))} hint="captação ao vivo" />
          <Kpi
            label="Assuntos de interesse"
            valor={String(deInteresse.length)}
            hint={`de ${pautas.length} pauta(s) captada(s)`}
          />
          <Kpi
            label="Pressão no rádio"
            valor={`${placar.critico} × ${placar.favoravel}`}
            hint="críticas × elogios à gestão"
          />
        </div>
        <div className="lg:col-span-2">
          <GravarAgora />
        </div>
      </div>

      {/* A rádio não entra no IAD, e a tela diz isso em vez de deixar o leitor
          supor que o número acima virou clima. */}
      <p className="rounded-xl border border-line bg-bg-1 px-4 py-3 text-sm text-txt-2">
        Este placar mede a <b>pressão da mídia</b>, não a aprovação popular: o rádio tem poucos
        microfones e muito tempo de fala, então ele não entra no IAD nem no clima da Estação
        Meteorológica. {vozOuvinte.length > 0
          ? `Nesta janela, ${vozOuvinte.length} pauta(s) vieram da fala de ouvinte, que é o trecho mais próximo da voz da população.`
          : "Nenhuma pauta desta janela veio da fala de ouvinte."}
      </p>

      {coordenadas.length > 0 && (
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="section-label mb-2">Assunto em mais de uma rádio no mesmo dia</div>
          <div className="space-y-2">
            {coordenadas.map((c, i) => (
              <div key={i} className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
                <span className="font-bold text-txt-1">{labelTema(c.pautas[0].tema)}</span>
                <span className="text-txt-2"> · {c.assunto}</span>
                <div className="mt-0.5 text-[13px] text-txt-3">
                  {c.estacoes.join(", ")} ({c.estacoes.length} estações)
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-txt-3">
            Assunto repetido por estações diferentes no mesmo dia é sinal mais forte que menção
            isolada: ou o fato é grande, ou a pauta está circulando.
          </p>
        </div>
      )}

      {isLoading && <p className="text-txt-2">Carregando captações…</p>}

      {!isLoading && estacoes.length === 0 && (
        <div className="rounded-xl border border-line bg-bg-1 p-5">
          <div className="text-lg font-extrabold text-txt-1">Nenhuma captação nesta janela</div>
          <p className="mt-1 text-sm text-txt-2">
            Cadastre as rádios abaixo e ative as que devem ser captadas. A gravação acontece no
            horário do programa, ao vivo, e a transcrição vem em seguida.
          </p>
        </div>
      )}

      {estacoes.map((r) => <CardEstacao key={r.estacao} r={r} />)}

      {cruzamento.length > 0 && (
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="section-label mb-2">Rádio e Instagram, por tema</div>
          <div className="space-y-1.5">
            {cruzamento.map((c) => (
              <div key={c.tema} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-sm">
                <span className="font-semibold text-txt-1">{labelTema(c.tema)}</span>
                <span className="flex items-center gap-4 text-txt-2">
                  <span>{c.radio} no rádio</span>
                  <span>{c.instagram} no Instagram</span>
                  {c.radio > 0 && c.instagram === 0 && (
                    <span className="rounded px-1.5 py-0.5 text-[12px] font-bold"
                          style={{ background: "rgba(249,115,22,0.14)", color: "#C2410C" }}>
                      só no rádio
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-txt-3">
            Tema que aparece só no rádio costuma chegar às redes depois. É o tempo que a
            comunicação tem para se preparar.
          </p>
        </div>
      )}

      <CadastroRadios />
    </div>
  );
}
