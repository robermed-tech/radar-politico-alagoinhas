import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchServiceStatus, type PipelineHealth } from "@/lib/data";
import { IconAlertBell, IconWarningTriangle } from "@/components/icons";

/**
 * Hero de saúde do pipeline — visível para qualquer usuário logado (não só
 * admin), em qualquer tela, porque "o radar parou" é informação relevante
 * antes de qualquer índice que ele mostra. Fica silencioso quando tudo está
 * normal (mesmo padrão dos outros banners do produto) e some assim que a
 * próxima execução normalizar.
 *
 * O aviso de coleta vazia tem botão de fechar (pedido do cliente em 06/08/26).
 * A dispensa vale para AQUELA execução — a chave guardada no localStorage é o
 * próprio `executado_em` — então a próxima rodada que continuar sem posts faz
 * o aviso voltar: cada execução vazia é um aviso novo. O estado "Radar parado"
 * NÃO ganha o X de propósito: ele diz que os números da tela estão defasados,
 * e um aviso desses dispensável viraria um painel desatualizado em silêncio.
 *
 * EXCEÇÃO: quando a causa é o teto da Apify, a dispensa é pela CAUSA e não
 * pela execução. A condição dura dias e quem a resolve é o dono da conta
 * (recarregar em apify.com/billing); com a chave por execução, quem já sabe
 * do problema teria de fechar o mesmo aviso 3x por dia. Fechou uma vez, some
 * até a situação mudar — e volta sozinho quando o consumo cair abaixo do teto
 * ou quando a coleta vazia passar a ter outra causa.
 *
 * Limiar espelha heartbeat_check.py: agora.yml roda 3x/dia (08h/14h/19h BRT),
 * maior intervalo é o noturno 19h -> 08h do dia seguinte = 13h por desenho.
 * Fica acima disso + folga de atraso normal do runner do GitHub, senão o
 * banner acende sozinho toda madrugada mesmo com o pipeline saudável.
 */

const LIMIAR_CRITICO_H = 15;
const CHAVE_DISPENSA = "radar_aviso_coleta_fechado";
/** Valor gravado na dispensa quando a causa é o teto da Apify (ver cabeçalho). */
const DISPENSA_APIFY = "apify-sem-credito";

function horasDesde(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * Estado de problema do pipeline — a MESMA régua do banner, exportada para o
 * radar da Estação Meteorológica (pedido do cliente em 06/08: o radar dizia
 * "em varredura" com o pipeline parado e "0 itens coletados hoje" ao lado,
 * porque o critério era só "existe fonte ativa cadastrada"). Fonte única:
 * banner aceso ⇒ radar ocioso, sem os dois indicadores discordarem.
 * `health` null/indefinido não acusa problema — sem leitura ainda, o radar
 * não deve abrir em âmbar por falta de dado.
 */
export function pipelineComProblema(health: PipelineHealth | null | undefined): boolean {
  if (!health?.executado_em) return false;
  const coletaVazia = health.status === "coleta_vazia" || (health.posts_coletados ?? 0) === 0;
  const parado = horasDesde(health.executado_em) > LIMIAR_CRITICO_H || health.status === "erro";
  return parado || coletaVazia;
}

function fmtQuando(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "data indisponível";
  }
}

export function PipelineHealthBanner({ health }: { health: PipelineHealth | null | undefined }) {
  // Uso da Apify (gravado a cada execução por agora.py::verificar_creditos_apify).
  // Quando o teto mensal estoura, a coleta volta ZERO posts — e o aviso genérico
  // ("possível bloqueio do Instagram, token expirado ou limite do Apify") mandava
  // o leitor investigar três hipóteses enquanto o próprio painel já sabia qual
  // era (medido em 06/08: 101,1% do teto, US$ 29,33 de US$ 29,00, travado nesse
  // valor desde 27/07). Consulta barata e cacheada; sem o dado, o texto genérico
  // continua valendo.
  const { data: apify } = useQuery({
    queryKey: ["service-status-apify"],
    queryFn: () => fetchServiceStatus("apify"),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // Última execução dispensada pelo usuário (persistida entre visitas).
  const [fechadoEm, setFechadoEm] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CHAVE_DISPENSA);
    } catch {
      return null;
    }
  });

  if (!health?.executado_em) return null;
  const executadoEm = health.executado_em;

  const horas = horasDesde(executadoEm);
  const parado = horas > LIMIAR_CRITICO_H || health.status === "erro";

  const critico = parado; // parado é sempre o estado mais grave

  // Causa CONHECIDA da coleta vazia: o teto da Apify estourou. Nesse caso o
  // aviso nomeia o serviço, mostra o consumo e diz o que fazer, em vez de
  // listar três hipóteses. Só vale para o estado de coleta vazia — com o
  // pipeline parado, o problema é outro (não rodou), e o crédito não explica.
  const apifyNoTeto = !critico && (apify?.uso_pct ?? 0) >= 100 && (apify?.teto_usd ?? 0) > 0;
  // Chave da dispensa: por CAUSA quando é o crédito da Apify (dura dias),
  // por execução no caso genérico (cada coleta vazia é um aviso novo).
  const chaveDispensa = apifyNoTeto ? DISPENSA_APIFY : executadoEm;

  if (!pipelineComProblema(health) || (!critico && fechadoEm === chaveDispensa)) return null;

  const fechar = () => {
    try {
      localStorage.setItem(CHAVE_DISPENSA, chaveDispensa);
    } catch {
      /* sem localStorage (modo privado), a dispensa vale só até recarregar */
    }
    setFechadoEm(chaveDispensa);
  };

  const cor = critico ? "#EF4444" : "#F97316";
  const bg = critico ? "rgba(239,68,68,0.10)" : "rgba(249,115,22,0.10)";
  const borda = critico ? "rgba(239,68,68,0.35)" : "rgba(249,115,22,0.35)";

  // Vírgula decimal: em português "US$ 29.33" se lê como outro número.
  const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
  const usoApify = apifyNoTeto ? `${usd(apify!.uso_usd)} de ${usd(apify!.teto_usd)}` : "";

  const titulo = critico
    ? `Radar parado há ${Math.round(horas)}h`
    : apifyNoTeto
      ? "Coleta parada: créditos da Apify esgotados"
      : "Última coleta não trouxe posts novos";

  const detalhe = critico
    ? "O pipeline não roda ou não grava dados no horário esperado. Os números abaixo podem estar defasados."
    : apifyNoTeto
      ? `O serviço que busca as publicações atingiu o teto mensal (${usoApify}) e parou de coletar. Recarregue em apify.com/billing para o radar voltar a trazer posts novos.`
      : "O pipeline executou, mas não coletou nenhum post. Possíveis causas: bloqueio do Instagram, token expirado ou limite do Apify.";

  return (
    <div
      className={`relative border-b px-4 py-3 ${critico ? "" : "pr-12"}`}
      style={{ background: bg, borderColor: borda }}
      role="alert"
    >
      {/* No celular o carimbo de horário desce para a linha de baixo
          (basis-full): antes ele era shrink-0 na mesma linha e espremia o
          título numa coluna de poucas palavras. No sm+ volta para a direita. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="mt-0.5 shrink-0" style={{ color: cor }}>
          {critico ? <IconAlertBell size={18} /> : <IconWarningTriangle size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold" style={{ color: cor }}>{titulo}</div>
          <div className="text-xs text-txt-2">{detalhe}</div>
        </div>
        <div className="basis-full text-[13px] text-txt-3 sm:ml-auto sm:basis-auto sm:shrink-0">
          Última execução: {fmtQuando(executadoEm)}
        </div>
      </div>
      {!critico && (
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar aviso"
          title="Fechar aviso"
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg text-txt-2 transition hover:bg-black/5 hover:text-txt-1"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
