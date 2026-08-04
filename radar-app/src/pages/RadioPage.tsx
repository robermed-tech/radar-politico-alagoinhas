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
import { useQuery } from "@tanstack/react-query";
import {
  fetchCapturas, fetchPautas, resumirPorEstacao, cruzarTemas, pautasCoordenadas,
  placarTom, fmtInstante, CONFIANCA_MIN_RADIO,
  type RadioPauta, type EstacaoResumo,
} from "@/lib/radio";
import { fetchRadar, filtrarPorPeriodo } from "@/lib/data";
import { PeriodoFilter, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { AlertaRadio } from "@/components/AlertaRadio";
import { AntenaStatusColumn } from "@/components/AntenaSinal";
import { ClipeCitacao } from "@/components/ClipeCitacao";
import { GravarAgora } from "@/components/GravarAgora";
import { RadiosMonitoradas } from "@/components/RadiosMonitoradas";
import { GaugeTema } from "@/components/GaugeTema";
import { OndasEq, LedVivo } from "@/components/SinalVivo";
import { ContadorAnimado } from "@/components/ContadorAnimado";
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

// Tom como TEXTO usa as tintas de sentimento (tokens por tema), nunca o par
// de gráfico #EF4444/#22C55E — cor de série é preenchimento, não letra
// (prévia aprovada em 04/08; a regra é a mesma dos @ da Análise por Perfil).
const TOM_COR: Record<string, string> = {
  critico: "var(--sent-ink-neg)",
  favoravel: "var(--sent-ink-pos)",
  neutro: "var(--txt3)",
  nao_classificado: "var(--txt3)",
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

function Kpi({ label, valor, hint }: { label: string; valor: number; hint?: string }) {
  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="section-label">{label}</div>
      {/* Número na display, contando na entrada — o mesmo par tamanho+rampa
          dos contadores da Estação Meteorológica (prévia aprovada em 04/08). */}
      <div className="tnum mt-1 font-display text-[36px] font-bold leading-none text-txt-1">
        <ContadorAnimado valor={valor} />
      </div>
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
                style={{ background: "rgba(255,106,43,0.14)", color: "var(--brand-text)" }}
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
          <div className="mt-1 font-display text-[17px] font-bold text-txt-1">{p.assunto}</div>
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

      {/* Fio laranja da prévia aprovada: a citação é o coração do card, e o
          fio cinza a deixava com cara de nota de rodapé. */}
      {p.citacao && (
        <div className="mt-2 border-l-[3px] pl-3" style={{ borderColor: "var(--brand)" }}>
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
  const captou = r.capturas > r.falhas;

  return (
    // Superfície de estação da prévia aprovada em 04/08: vidro quente com
    // borda laranja (tokens --estacao-*, dois temas). Estação que só falhou
    // leva a borda avermelhada — o card inteiro já avisa antes do texto.
    <div
      className="rounded-[20px] p-5"
      style={{
        background: "var(--estacao-bg)",
        border: `1px solid ${naoCaptada ? "rgba(194,38,38,0.30)" : "var(--estacao-borda)"}`,
        boxShadow: "var(--shadow-ambient)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            {/* LED + equalizador só quando a estação de fato gravou na janela —
                é a distinção falha ≠ silêncio dos cards: estação que falhou
                não pode parecer "no ar". */}
            <LedVivo ligado={captou} size={9} />
            <div className="font-display text-xl font-extrabold text-txt-1">{r.estacao}</div>
            {captou && <OndasEq ativo />}
          </div>
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
          sistema está ouvindo, depois o que ele ouviu), o CADASTRO das estações
          no meio e, à direita, o card de gravação sob demanda.

          O cadastro subiu para cá em 30/07, a pedido do cliente: ele vivia num
          card claro no rodapé da página, a uma rolagem inteira do botão GRAVAR,
          e as duas coisas que se faz nesta tela (definir quais rádios existem e
          pedir uma captação avulsa) ficavam em pontas opostas. As perguntas
          continuam separadas — lá se define o horário em que a estação grava
          sozinha, aqui se pede uma gravação agora —, só que agora lado a lado.

          Os quatro indicadores desceram para a linha seguinte, em 4 colunas: o
          espaço que ocupavam aqui é o do cadastro, e eles são leitura, não
          controle. */}
      {/* Colunas por TAMANHO EXPLÍCITO, não por fração de 6: antena e Gravar
          Agora têm largura própria (a antena cresceu em 31/07 e precisa de
          piso; o card de gravar é fixo em 380px, ver GravarAgora), e o
          Rádios Monitoradas é a única coluna FLEXÍVEL — absorve toda a
          sobra. Com `lg:grid-cols-6` fracionário, os 380px fixos do card de
          gravar sobravam dentro de uma coluna de 2/6 mais larga que isso em
          telas grandes, e o vão vazio entre os dois cards era exatamente
          essa sobra. Coluna flexível em vez de fração fixa fecha o vão
          fechando o cálculo, não escondendo o sintoma. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_380px]">
        <div>
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
        <div>
          <RadiosMonitoradas />
        </div>
        <div>
          <GravarAgora />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Rádios captadas"
          valor={estacoesCaptadas}
          hint={`${estacoes.length} monitorada(s) na janela`}
        />
        <Kpi label="Minutos transcritos" valor={Math.round(minutos)} hint="captação ao vivo" />
        <Kpi
          label="Assuntos de interesse"
          valor={deInteresse.length}
          hint={`de ${pautas.length} pauta(s) captada(s)`}
        />
        {/* Mesmo velocímetro do Termômetro por tema (Estação Meteorológica),
            sem forquilha: o número grande "N × M" saiu, o gauge já mostra a
            proporção crítica/elogio no arco e repete as contagens embaixo
            (vermelho = crítica, verde = elogio, a mesma convenção do resto
            do painel). `neg`/`pos` do componente são genéricos de propósito
            — aqui valem como crítica/elogio à gestão. */}
        <GaugeTema label="Pressão no rádio" neg={placar.critico} pos={placar.favoravel} />
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
            Cadastre as rádios no card &ldquo;Rádios monitoradas&rdquo;, acima, e ative as que devem
            ser captadas. A gravação acontece no horário do programa, ao vivo, e a transcrição vem
            em seguida.
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
    </div>
  );
}
