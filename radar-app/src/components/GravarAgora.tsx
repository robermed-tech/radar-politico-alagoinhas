import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  estadoGravacao, fetchRadios, gravarAgora, pararGravacao, programasDe,
  type RadioFonte,
} from "@/lib/radio";
import { ConfirmaModal } from "@/components/ConfirmaModal";
import { OndasEq } from "@/components/SinalVivo";
import {
  FUNDO_ESCUTA, FUNDO_LARANJA, TINTA_PRETA, TINTA_CLARA, TINTA_CLARA_2,
  FUNDO_LISTA, FUNDO_ITEM, BORDA, SOMBRA, ALTURA_MIN, ALTURA_MAX,
} from "@/components/superficieRadio";

/**
 * Card de gravação sob demanda — canto superior direito da Escuta do Rádio.
 *
 * Formato: card QUADRADO na mesma linha do painel da antena e dos indicadores
 * (revisão de 30/07). A primeira versão era uma faixa retangular de largura
 * cheia acima de tudo, e ela empurrava a leitura da página inteira para baixo
 * por causa de um controle que se usa de vez em quando. Como card da linha de
 * topo, ele fica à mão sem tomar a dobra.
 *
 * Lista as rádios CADASTRADAS, não só as ativas. `active` governa a captação
 * automática no horário do programa; pedir uma gravação agora é outra coisa, e
 * recusar uma estação cadastrada porque ela está pausada seria dizer não a um
 * pedido explícito. A estação pausada aparece marcada como tal — quem escolhe
 * precisa saber que ela não grava sozinha —, mas pode ser gravada.
 *
 * Mecânica: GRAVAR aciona o workflow `radio.yml` pela Edge Function
 * `gravar-radio`. O disparo não sai do navegador porque exige um token com
 * permissão de Actions, e esse token no bundle daria a qualquer visitante do
 * painel o poder de queimar crédito da Apify.
 *
 * O MESMO botão para a captação. Duas decisões sustentam isso:
 *
 * 1. O estado vem da APIFY, não do GitHub. O `workflow_dispatch` é
 *    disparar-e-esquecer (o GitHub responde 204 sem id de run), e cancelar o
 *    job não interrompe o ator, que grava e cobra por conta própria. Enquanto a
 *    função não souber o que está no ar (`indisponivel`), o botão continua só
 *    GRAVAR: melhor não oferecer PARAR do que oferecer um PARAR que não para.
 *
 * 2. Os dois estados não se parecem. GRAVAR é a pílula teal chapada com tinta
 *    escura; gravando, o botão vira o MEDIDOR da captação — trilho petróleo,
 *    avanço em teal, equalizador e o tempo que falta, com tinta clara. Um
 *    toggle que só troca a palavra convida ao clique errado, e aqui o clique
 *    errado ou queima crédito ou joga fora áudio já pago. Vermelho seria o
 *    óbvio para parar e continua proibido: neste painel vermelho é sentimento.
 *
 * Paleta: degradê chumbo→quase-preto (o mesmo do radar de coleta, do painel da
 * antena e do box de comentário) com o botão na cor da marca (`var(--brand)`,
 * chapado) e texto quase preto — medido em 8,44:1 de contraste. Vermelho seria
 * o óbvio para "REC", mas neste painel vermelho é sentimento negativo, nunca
 * controle. As constantes moram em `superficieRadio.ts` desde que o card
 * "Rádios monitoradas" passou a usar a mesma superfície: duas cópias só ficam
 * iguais até alguém mexer numa delas.
 */

const DURACOES = [15, 30, 45, 90, 120] as const;
/**
 * A partir daqui a captação é longa o bastante para o custo pesar e para a
 * transcrição entrar em terreno não testado: o maior bloco já transcrito com
 * sucesso tem 10 minutos, e ninguém sabe ainda como o ator lida com áudio de
 * duas horas no Whisper. A tela avisa em vez de deixar a pessoa descobrir
 * depois de pagar a captação inteira.
 */
const DURACAO_LONGA = 90;
/** ~US$ 0,014 por minuto de run, medido no único run de rádio bem-sucedido
 *  (10,3 min por US$ 0,14). Serve para dar ordem de grandeza, não para cobrar. */
const USD_POR_MINUTO = 0.014;

/** Trilho do medidor: a mesma receita de chip sobre superfície escura já usada
 *  no selo "pausada" e no banner de mensagem — fundo quase sólido, porque alfa
 *  baixo sobre o degradê derruba o contraste do que vai por cima. */
const MEDIDOR_TRILHO = "rgba(2,6,23,0.88)";
/** Avanço em teal translúcido: sobre o trilho ele fica em torno de #1E4A55, e a
 *  tinta clara mede acima de 8:1 nos dois lados da fronteira — por isso o rótulo
 *  pode atravessar o medidor sem trocar de cor no meio. */
const MEDIDOR_AVANCO = "rgba(98,194,202,0.34)";

/** Espera até a captação aparecer na Apify. O job precisa subir, instalar o
 *  ffmpeg e iniciar o ator; passado esse teto, o botão para de prometer. */
const ESPERA_INICIO_MS = 6 * 60 * 1000;

function mmss(seg: number): string {
  const s = Math.max(0, Math.round(seg));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function rotulo(r: RadioFonte): string {
  return (r.label || r.handle || "").trim() || "sem nome";
}

export function GravarAgora() {
  const { data: radios = [] } = useQuery({
    queryKey: ["radios"],
    queryFn: fetchRadios,
    staleTime: 60 * 1000,
  });

  const [sel, setSel] = useState<string[]>([]);
  const [duracao, setDuracao] = useState<number>(30);
  const [enviando, setEnviando] = useState(false);
  const [parando, setParando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  /** Instante do pedido, para cobrir a janela entre o disparo e o run aparecer. */
  const [pedidoEm, setPedidoEm] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  // Estado real da captação. Enquanto algo grava, pergunta de 10 em 10s (o
  // contador precisa fechar sozinho quando o bloco termina); parado, de minuto
  // em minuto, que é só para pegar captação iniciada pelo horário do programa.
  const { data: estado, refetch: refetchEstado } = useQuery({
    queryKey: ["radio-gravacao"],
    queryFn: estadoGravacao,
    refetchInterval: (q) =>
      q.state.data?.gravando || pedidoEm !== null ? 10 * 1000 : 60 * 1000,
    // Erro de consulta mantém o último estado conhecido: trocar para "nada
    // gravando" ofereceria GRAVAR por cima de uma captação viva.
    retry: false,
  });

  const emCurso = estado?.runs?.[0] ?? null;
  const gravando = Boolean(estado?.gravando && emCurso);
  // Sem APIFY_API_TOKEN na função não há como saber nem abortar: o botão fica
  // só com GRAVAR, em vez de exibir um PARAR que não cumpre o que promete.
  const podeParar = !estado?.indisponivel;

  // Relógio de 1s: só existe enquanto há algo para contar.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!gravando && pedidoEm === null) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [gravando, pedidoEm]);

  // O run apareceu: a espera acabou. Ou estourou o teto e a promessa cai.
  useEffect(() => {
    if (pedidoEm === null) return;
    if (gravando) { setPedidoEm(null); return; }
    if (agora - pedidoEm > ESPERA_INICIO_MS) {
      setPedidoEm(null);
      setMsg({
        ok: false,
        texto: "A captação não apareceu na Apify em 6 min. Confira o run do radio.yml no GitHub.",
      });
    }
  }, [agora, gravando, pedidoEm]);

  const decorrido = emCurso?.desde
    ? Math.max(0, (agora - new Date(emCurso.desde).getTime()) / 1000)
    : 0;
  const total = emCurso?.duracaoMin ? emCurso.duracaoMin * 60 : null;
  const restante = total !== null ? Math.max(0, total - decorrido) : null;
  // Sem duração no INPUT do run o medidor não inventa avanço: fica em zero e o
  // botão mostra o tempo DECORRIDO, que é o que se sabe de verdade.
  const pct = total !== null && total > 0 ? Math.min(100, (decorrido / total) * 100) : 0;
  const aguardandoInicio = pedidoEm !== null && !gravando;

  // Só mantém escolhida estação que ainda existe no cadastro: apagar uma rádio
  // com ela marcada deixaria um id fantasma no pedido.
  const escolhidas = useMemo(
    () => sel.filter((id) => radios.some((r) => r.id === id)),
    [sel, radios]
  );

  function alternar(id: string) {
    setMsg(null);
    setSel((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function disparar() {
    if (escolhidas.length === 0 || enviando) return;
    setEnviando(true);
    setMsg(null);
    const { erro, resultado } = await gravarAgora(escolhidas, duracao);
    setEnviando(false);
    if (erro) {
      setMsg({ ok: false, texto: erro });
      return;
    }
    const nomes = resultado?.estacoes?.join(", ") || "as estações escolhidas";
    setMsg({
      ok: true,
      texto: `Gravando ${nomes} por ${resultado?.duracao ?? duracao} min. As pautas aparecem quando a captação terminar.`,
    });
    setSel([]);
    // A captação leva ~1 min para existir na Apify (o job sobe, instala o
    // ffmpeg, inicia o ator). Até lá o botão diz "Iniciando", em vez de voltar
    // a oferecer GRAVAR e convidar a um segundo disparo pago.
    setPedidoEm(Date.now());
  }

  async function parar() {
    setConfirmando(false);
    if (parando) return;
    setParando(true);
    setMsg(null);
    const { erro, resultado } = await pararGravacao();
    setParando(false);
    setPedidoEm(null);
    if (erro) {
      setMsg({ ok: false, texto: erro });
      return;
    }
    await refetchEstado();
    setMsg(
      resultado?.nada
        ? { ok: true, texto: "A captação já havia terminado sozinha. Nada foi interrompido." }
        : {
            ok: true,
            texto: "Captação encerrada. O áudio já gravado foi descartado e não vira pauta.",
          },
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-[28px] p-5 lg:ml-auto lg:max-w-[380px]"
      style={{
        background: FUNDO_ESCUTA,
        // Piso que mantém a proporção quadrada na coluna de ~380px, mesmo com
        // o cadastro vazio (quando a lista tem só a frase de estado).
        minHeight: ALTURA_MIN,
        // Mesmo teto do card "Rádios monitoradas": teto diferente entre os dois
        // deixa faixa vazia embaixo do mais baixo, porque o grid dimensiona a
        // linha pelo item mais alto.
        maxHeight: ALTURA_MAX,
        boxShadow: SOMBRA,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <div
          className="text-[13px] uppercase tracking-[0.14em]"
          style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
        >
          Gravar agora
        </div>
        <div className="text-[13px]" style={{ color: TINTA_CLARA_2, fontWeight: 600 }}>
          {escolhidas.length > 0 ? `${escolhidas.length} ${escolhidas.length === 1 ? "escolhida" : "escolhidas"}` : "escolha abaixo"}
        </div>
      </div>

      {/* Caixa de escolha das rádios cadastradas. Rola por dentro para o card
          não crescer com o número de estações. */}
      <div
        className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl p-2"
        style={{ background: FUNDO_LISTA, border: BORDA }}
      >
        {radios.length === 0 ? (
          <p className="p-2 text-[13px] leading-relaxed" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
            Nenhuma rádio cadastrada. Cadastre uma estação no card &ldquo;Rádios
            monitoradas&rdquo;, ao lado.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {radios.map((r) => {
              const ativo = escolhidas.includes(r.id);
              return (
                <li key={r.id}>
                  <button
                    onClick={() => alternar(r.id)}
                    aria-pressed={ativo}
                    disabled={gravando}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                    style={
                      ativo
                        ? { background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }
                        : { background: FUNDO_ITEM, color: TINTA_CLARA, fontWeight: 700, border: BORDA }
                    }
                    title={
                      programasDe(r.config).filter((p) => p.nome).length
                        ? `Programas: ${programasDe(r.config).map((p) => p.nome).filter(Boolean).join(", ")}`
                        : rotulo(r)
                    }
                  >
                    {/* Laranja da marca no lugar do verde (onda 2 de 03/08:
                        verde é exclusivo de sentimento). No chip selecionado o
                        fundo já é laranja, então o ponto vira tinta preta. */}
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: ativo ? TINTA_PRETA : r.active ? "var(--brand)" : "#94A3B8" }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{rotulo(r)}</span>
                    {/* Pausada pode ser gravada sob demanda; o selo existe para
                        ninguém achar que ela também grava sozinha. */}
                    {!r.active && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[12px] uppercase"
                        style={{
                          background: ativo ? "rgba(26,15,2,0.16)" : "rgba(2,6,23,0.88)",
                          color: ativo ? TINTA_PRETA : TINTA_CLARA_2,
                          fontWeight: 700,
                        }}
                      >
                        pausada
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Duração. O teto real (60 min) é validado na Edge Function: cada minuto
          pedido é um minuto pago de run na Apify, que grava em tempo real. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="w-full text-[13px]" style={{ color: TINTA_CLARA_2, fontWeight: 600 }}>
          Duração
        </span>
        {DURACOES.map((d) => {
          const ativo = duracao === d;
          return (
            <button
              key={d}
              onClick={() => setDuracao(d)}
              aria-pressed={ativo}
              disabled={gravando}
              className="tnum rounded-lg px-2.5 py-1 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50"
              style={
                ativo
                  ? { background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }
                  : { background: FUNDO_ITEM, color: TINTA_CLARA, fontWeight: 700, border: BORDA }
              }
            >
              {d} min
            </button>
          );
        })}
      </div>

      {gravando && podeParar ? (
        /* O botão VIRA o medidor da captação: trilho petróleo, avanço em teal e
           o tempo que falta. A tinta é clara nos dois lados da fronteira do
           avanço (medido acima de 8:1 nas duas), então o rótulo atravessa o
           medidor sem trocar de cor no meio. */
        <button
          onClick={() => setConfirmando(true)}
          disabled={parando}
          className="relative mt-3 w-full overflow-hidden rounded-full py-3 text-[17px] uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-60"
          // Sem a borda hairline da lista de propósito: com ela o botão lia
          // como campo de formulário, e aqui ele é o instrumento da captação.
          style={{ background: MEDIDOR_TRILHO, color: TINTA_CLARA, fontWeight: 800 }}
          aria-label={
            restante !== null
              ? `Parar a captação em curso — faltam ${mmss(restante)}`
              : `Parar a captação em curso — gravando há ${mmss(decorrido)}`
          }
          title="Encerra a captação agora e descarta o áudio já gravado"
        >
          <span
            className="medidor-avanco absolute inset-y-0 left-0"
            style={{ width: `${pct}%`, background: MEDIDOR_AVANCO }}
            aria-hidden
          />
          <span className="relative flex items-center justify-center gap-2.5">
            <OndasEq ativo={!parando} cor="var(--brand)" altura={14} barras={5} />
            <span>{parando ? "Parando…" : "Parar"}</span>
            <span className="tnum text-[15px]" style={{ color: TINTA_CLARA_2, fontWeight: 700 }}>
              {restante !== null ? mmss(restante) : mmss(decorrido)}
            </span>
          </span>
        </button>
      ) : (
        <button
          onClick={disparar}
          disabled={escolhidas.length === 0 || enviando || aguardandoInicio}
          className="mt-3 w-full rounded-full py-3 text-[17px] uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }}
          title={
            escolhidas.length === 0
              ? "Escolha ao menos uma rádio na lista"
              : `Gravar ${escolhidas.length} ${escolhidas.length === 1 ? "estação" : "estações"} por ${duracao} min`
          }
        >
          {enviando || aguardandoInicio ? "Iniciando…" : "Gravar"}
        </button>
      )}

      {msg ? (
        <div
          role="status"
          className="mt-2 rounded-lg px-3 py-2 text-[13px] leading-snug"
          style={{
            background: "rgba(2,6,23,0.88)",
            color: msg.ok ? "#86EFAC" : "#FCA5A5",
            fontWeight: 600,
          }}
        >
          {msg.texto}
        </div>
      ) : gravando ? (
        <p className="mt-2 text-[12px] leading-snug" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
          {emCurso?.estacoes.length
            ? `Captando ${emCurso.estacoes.join(", ")}`
            : "Captação em curso"}
          {restante !== null && emCurso?.duracaoMin
            ? ` · faltam ${mmss(restante)} de ${emCurso.duracaoMin} min`
            : ` · gravando há ${mmss(decorrido)}`}
          . Parar encerra agora e descarta o áudio: a transcrição só sai no fim do bloco.
        </p>
      ) : aguardandoInicio ? (
        <p className="mt-2 text-[12px] leading-snug" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
          A captação leva cerca de um minuto para começar: o job precisa subir e
          iniciar o ator. O contador aparece aqui quando ela estiver no ar.
        </p>
      ) : duracao >= DURACAO_LONGA ? (
        <p className="mt-2 text-[12px] leading-snug" style={{ color: "#FED7AA", fontWeight: 600 }}>
          {duracao} min ao vivo custam cerca de US$ {(duracao * USD_POR_MINUTO).toFixed(2)} de
          Apify por estação, e captação longa ainda não foi testada na transcrição.
        </p>
      ) : (
        <p className="mt-2 text-[12px] leading-snug" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
          Captação ao vivo, fora do horário do programa: {duracao} min pedidos são {duracao} min
          de gravação.
        </p>
      )}

      {/* Parar é destrutivo: encerra uma captação paga e joga fora o áudio dela.
          Confirmação pela casca única do painel, dizendo a consequência de
          frente — nunca `window.confirm`. */}
      {confirmando && (
        <ConfirmaModal
          titulo="Parar a captação?"
          rotuloConfirmar="Parar e descartar"
          onConfirmar={parar}
          onCancelar={() => setConfirmando(false)}
          mensagem={
            <>
              O áudio já gravado é <strong>descartado</strong>: o ator só transcreve no fim
              do bloco, então uma captação interrompida não vira pauta nenhuma.
              {restante !== null
                ? ` Parar agora evita os ${mmss(restante)} que faltam; os minutos já
                    consumidos na Apify não voltam.`
                : " Os minutos já consumidos na Apify não voltam."}
            </>
          }
        />
      )}
    </div>
  );
}
