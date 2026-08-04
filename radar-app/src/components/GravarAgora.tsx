import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadios, gravarAgora, programasDe, type RadioFonte } from "@/lib/radio";
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
 * Paleta: degradê chumbo→quase-preto (o mesmo do radar de coleta, do painel da
 * antena e do box de comentário) com o botão em laranja da marca (`var(--brand)`,
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
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

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
      <div className="flex items-baseline justify-between gap-2">
        <div
          className="text-[13px] uppercase tracking-[0.14em]"
          style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
        >
          Gravar agora
        </div>
        <div className="text-[13px]" style={{ color: TINTA_CLARA_2, fontWeight: 600 }}>
          {escolhidas.length > 0 ? `${escolhidas.length} escolhida(s)` : "escolha abaixo"}
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
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition"
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
              className="tnum rounded-lg px-2.5 py-1 text-[13px] transition"
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

      <button
        onClick={disparar}
        disabled={escolhidas.length === 0 || enviando}
        className="mt-3 w-full rounded-full py-3 text-[17px] uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-45"
        style={{ background: FUNDO_LARANJA, color: TINTA_PRETA, fontWeight: 800 }}
        title={
          escolhidas.length === 0
            ? "Escolha ao menos uma rádio na lista"
            : `Gravar ${escolhidas.length} estação(ões) por ${duracao} min`
        }
      >
        {enviando ? "Iniciando…" : "Gravar"}
      </button>

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
    </div>
  );
}
