import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadios, gravarAgora, type RadioFonte } from "@/lib/radio";

/**
 * Box de gravação sob demanda — topo da Escuta do Rádio.
 *
 * Pedido de 30/07: um box em destaque com o botão GRAVAR e a escolha de quais
 * rádios captar naquele momento. O cadastro (card "Rádios monitoradas") segue
 * intocado: lá se define QUAIS estações existem e em que horário elas gravam
 * sozinhas; aqui se pede uma captação AGORA, fora daquele horário.
 *
 * Sobre a mecânica: apertar GRAVAR aciona o workflow `radio.yml` pela Edge
 * Function `gravar-radio`. O disparo NÃO pode sair direto do navegador porque
 * exige um token com permissão de Actions, e esse token no bundle daria a
 * qualquer visitante do painel o poder de queimar crédito da Apify. A função
 * confere o papel de admin, valida as estações contra o tenant e só então
 * dispara.
 *
 * Sobre a espera: o ator da Apify grava em TEMPO REAL, então uma captação de 30
 * minutos leva 30 minutos. A tela diz isso em vez de fingir resultado imediato
 * — o texto de sucesso fala em "as pautas aparecem quando a captação terminar",
 * que é a verdade do pipeline.
 *
 * Paleta: o box usa o degradê chumbo→quase-preto que já identifica a escuta
 * (radar de coleta, painel da antena, box de comentário). O botão é laranja da
 * marca com texto quase preto, a receita do card "Engajamento no período" —
 * medido, 8,34:1 na ponta clara e 5,30:1 na escura. Vermelho seria a cor óbvia
 * para "REC", mas neste painel vermelho é sentimento negativo, nunca controle.
 */

const FUNDO_ESCUTA = "linear-gradient(165deg, #475569 0%, #0F172A 100%)";
const FUNDO_BOTAO = "linear-gradient(150deg, #FB923C 0%, #EA580C 100%)";
const TINTA_PRETA = "#1A0F02";
const TINTA_CLARA = "#F8FAFC";
const TINTA_CLARA_2 = "#CBD5E1";
/** Superfície do card interno de escolha, sobre o degradê. Quase sólido, nunca
 *  um alpha baixo: o degradê varia demais para um translúcido leve compensar. */
const FUNDO_CARD_INTERNO = "rgba(2,6,23,0.55)";

const DURACOES = [15, 30, 45] as const;

function rotulo(r: RadioFonte): string {
  return (r.label || r.handle || "").trim() || "sem nome";
}

export function GravarAgora() {
  const { data: radios = [] } = useQuery({
    queryKey: ["radios"],
    queryFn: fetchRadios,
    staleTime: 60 * 1000,
  });

  const ativas = useMemo(() => radios.filter((r) => r.active), [radios]);
  const [sel, setSel] = useState<string[]>([]);
  const [duracao, setDuracao] = useState<number>(30);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  // Estação pausada não é escolhível: o coletor só grava fonte ativa, e um chip
  // clicável que o backend descarta em silêncio seria um botão que mente.
  const escolhidas = useMemo(
    () => sel.filter((id) => ativas.some((r) => r.id === id)),
    [sel, ativas]
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
      texto:
        `Gravando ${nomes} por ${resultado?.duracao ?? duracao} minutos. ` +
        "A captação é ao vivo, então as pautas aparecem nesta tela quando ela terminar.",
    });
    setSel([]);
  }

  return (
    <div
      className="overflow-hidden rounded-[28px] p-5 sm:p-6"
      style={{ background: FUNDO_ESCUTA, boxShadow: "0 18px 40px -18px rgba(15,23,42,0.65)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="text-[13px] uppercase tracking-[0.14em]"
            style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
          >
            Gravar agora
          </div>
          <p className="mt-1 max-w-[52ch] text-sm" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
            Captação imediata, fora do horário cadastrado do programa. A gravação é ao
            vivo: {duracao} minutos pedidos são {duracao} minutos de captação.
          </p>
        </div>

        <button
          onClick={disparar}
          disabled={escolhidas.length === 0 || enviando}
          className="shrink-0 rounded-full px-8 py-3 text-[17px] uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: FUNDO_BOTAO, color: TINTA_PRETA, fontWeight: 800 }}
          title={
            escolhidas.length === 0
              ? "Escolha ao menos uma rádio abaixo"
              : `Gravar ${escolhidas.length} estação(ões) por ${duracao} min`
          }
        >
          {enviando ? "Iniciando…" : "Gravar"}
        </button>
      </div>

      {/* Card de escolha das estações. */}
      <div
        className="mt-4 rounded-2xl p-4"
        style={{ background: FUNDO_CARD_INTERNO, border: "1px solid rgba(148,163,184,0.30)" }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13px] uppercase tracking-[0.12em]" style={{ color: TINTA_CLARA, fontWeight: 700 }}>
            Quais rádios gravar
          </div>
          <div className="text-[13px]" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
            {escolhidas.length === 0
              ? "nenhuma escolhida"
              : `${escolhidas.length} de ${ativas.length} escolhida(s)`}
          </div>
        </div>

        {ativas.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: TINTA_CLARA_2, fontWeight: 500 }}>
            Nenhuma rádio ativa. Cadastre e ative uma estação no card &ldquo;Rádios
            monitoradas&rdquo;, mais abaixo nesta página.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {ativas.map((r) => {
              const ativo = escolhidas.includes(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => alternar(r.id)}
                  aria-pressed={ativo}
                  className="rounded-full px-4 py-2 text-sm transition"
                  style={
                    ativo
                      ? { background: FUNDO_BOTAO, color: TINTA_PRETA, fontWeight: 800 }
                      : {
                          background: "rgba(2,6,23,0.72)",
                          color: TINTA_CLARA,
                          fontWeight: 700,
                          border: "1px solid rgba(148,163,184,0.34)",
                        }
                  }
                  title={r.config?.programa ? `Programa: ${r.config.programa}` : rotulo(r)}
                >
                  {rotulo(r)}
                </button>
              );
            })}
          </div>
        )}

        {/* Duração. Teto de 45 min na tela (a função corta em 60): cada minuto
            pedido é um minuto pago de run na Apify. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px]" style={{ color: TINTA_CLARA_2, fontWeight: 600 }}>
            Duração
          </span>
          {DURACOES.map((d) => {
            const ativo = duracao === d;
            return (
              <button
                key={d}
                onClick={() => setDuracao(d)}
                aria-pressed={ativo}
                className="tnum rounded-lg px-3 py-1.5 text-sm transition"
                style={
                  ativo
                    ? { background: FUNDO_BOTAO, color: TINTA_PRETA, fontWeight: 800 }
                    : {
                        background: "rgba(2,6,23,0.72)",
                        color: TINTA_CLARA,
                        fontWeight: 700,
                        border: "1px solid rgba(148,163,184,0.34)",
                      }
                }
              >
                {d} min
              </button>
            );
          })}
        </div>
      </div>

      {msg && (
        <div
          role="status"
          className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{
            background: "rgba(2,6,23,0.88)",
            color: msg.ok ? "#86EFAC" : "#FCA5A5",
            fontWeight: 600,
          }}
        >
          {msg.texto}
        </div>
      )}
    </div>
  );
}
