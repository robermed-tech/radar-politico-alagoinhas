import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBriefing, fetchCrisisPlans, type CrisisPlan } from "@/lib/data";
import { NIVEL_COLOR, NIVEL_LABEL, nivelBadgeStyle, type NivelCrise } from "@/lib/indices";
import { IconAlertBell, IconCheckCircle } from "@/components/icons";
import { PeriodoFilter, periodoLabel, periodoFrase, periodoArtigo, type Dias } from "@/components/PeriodoFilter";
import { ContadorAnimado } from "@/components/ContadorAnimado";
import { EnvioSecretario } from "@/components/EnvioSecretario";
import { findSecretario } from "@/config/secretarios";
import { fraseCapitalizada } from "@/lib/format";
import { EsqueletoPagina } from "@/components/EsqueletoPagina";

/** Ordem de exibição: crítico sempre primeiro (prévia aprovada em 04/08). */
const ORDEM_NIVEL: Record<string, number> = { critico: 0, alto: 1, moderado: 2, baixo: 3 };

/** "há 2h" / "há 6 dias" — quão velho é o alerta que está pedindo ação. */
function idadeDoAlerta(iso: string): string {
  const horas = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (!Number.isFinite(horas) || horas < 0) return "";
  if (horas < 1) return "agora há pouco";
  if (horas < 24) return `há ${Math.round(horas)}h`;
  const d = Math.round(horas / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/**
 * "Alertar Secretário" a partir de um plano do Caçador de Crises — o mesmo
 * modal do dashboard (EnvioSecretario): canal, contato, edição, registro em
 * message_log e Histórico de Alertas idênticos. Acréscimo aprovado na prévia
 * de 04/08: a ação morava só na Estação Meteorológica, a uma tela de
 * distância do alerta que a justifica.
 */
function AlertarSecretarioPlano({ p }: { p: CrisisPlan }) {
  const [aberto, setAberto] = useState(false);
  const sec = findSecretario(p.tema ?? "");
  const msg = useMemo(() => {
    const nivel = NIVEL_LABEL[(p.nivel as NivelCrise) ?? "alto"] ?? p.nivel;
    return (
      `⚠️ *Alerta ${nivel.toUpperCase()}* — ${fraseCapitalizada(p.tema ?? "situação em monitoramento")}\n\n` +
      `O que disparou: ${p.pavio}\n\n` +
      (p.risco_se_ignorar ? `Risco se ignorar: ${p.risco_se_ignorar}\n\n` : "") +
      (p.post_url ? `Post: ${p.post_url}\n\n` : "") +
      `Identificado pelo monitoramento do Viratempo.`
    );
  }, [p]);
  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="rounded-full bg-brand px-4 py-1.5 text-[13px] font-extrabold text-brand-ink transition hover:opacity-90 active:scale-95"
        aria-label={`Alertar secretário sobre ${p.tema ?? "esta situação"}`}
      >
        Alertar Secretário
      </button>
      <EnvioSecretario
        aberto={aberto}
        onFechar={() => setAberto(false)}
        titulo="Alertas & Ações"
        subtitulo="Encaminhar a situação ao secretário responsável"
        cor="#F97316"
        icone={<IconAlertBell size={20} style={{ color: "#F97316" }} />}
        assunto={`⚠️ Alerta — ${fraseCapitalizada(p.tema ?? "situação em monitoramento")}`}
        mensagemBase={msg}
        tema={p.tema ?? "comunicacao"}
        contatoWhatsapp={sec.whatsapp}
        contatoEmail={sec.email}
      />
    </>
  );
}

const IMPACTO_COR: Record<string, string> = {
  alto: "#22C55E",
  medio: "#EAB308",
  baixo: "#5F6E8C",
};


function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-bold uppercase"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}
    >
      {children}
    </span>
  );
}

/**
 * Planos de ação do Caçador de Crises — apenas crises reais.
 *
 * Prévia aprovada em 04/08: o fundo lavado de laranja saiu (alerta é exceção;
 * quando a página inteira é cor de alerta, nada se destaca). Entram o resumo
 * por severidade no topo (contadores comparáveis), cards NEUTROS com espinha
 * de severidade à esquerda, crítico sempre primeiro, título curto (o tema) e
 * a ação "Alertar Secretário" no próprio card. As cores de nível continuam
 * vindo de NIVEL_COLOR — o laranja/vermelho de RISCO é o sistema paralelo de
 * alerta, não a cor da marca.
 */
function PlanosAcao({ planos, dias }: { planos: CrisisPlan[]; dias: Dias }) {
  const reais = useMemo(
    () =>
      planos
        .filter((p) => p.e_crise_real)
        .sort(
          (a, b) =>
            (ORDEM_NIVEL[a.nivel] ?? 9) - (ORDEM_NIVEL[b.nivel] ?? 9) ||
            (b.score_risco ?? 0) - (a.score_risco ?? 0)
        ),
    [planos]
  );
  const criticos = reais.filter((p) => p.nivel === "critico").length;
  const altos = reais.filter((p) => p.nivel === "alto").length;

  // Vazio na JANELA (não "vazio no banco"): desde o recorte por período, some
  // dizer nada aqui deixaria a seção desaparecer sem explicação, e quem lê não
  // sabe se não houve crise ou se a tela quebrou.
  if (planos.length === 0) {
    return (
      <div className="rounded-[20px] border border-line bg-bg-1 p-5">
        <div className="flex items-center gap-2">
          <IconCheckCircle size={18} className="shrink-0 text-risk-low" />
          <h2 className="text-base font-extrabold text-txt-1">
            Nenhum alerta de crise {periodoFrase(dias)}
          </h2>
        </div>
        <p className="mt-2 text-sm text-txt-2">
          Nenhuma publicação do período foi classificada como risco alto. Amplie a janela
          acima para ver situações anteriores.
        </p>
      </div>
    );
  }

  if (reais.length === 0) {
    return (
      <div className="rounded-[20px] border border-line bg-bg-1 p-5">
        <div className="flex items-center gap-2">
          <IconCheckCircle size={18} className="shrink-0 text-risk-low" />
          <h2 className="text-base font-extrabold text-txt-1">Nenhuma crise real identificada</h2>
        </div>
        <p className="mt-2 text-sm text-txt-2">
          Os posts de alto risco {periodoFrase(dias)} foram analisados pela IA e
          classificados como ruído, sem exigir ação imediata.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Resumo por severidade: o "N situações" vira número comparável. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-hover flex items-center gap-4 rounded-[20px] border border-line bg-bg-1 px-5 py-4">
          <span className="tnum font-display text-[38px] font-bold leading-none" style={{ color: NIVEL_COLOR.critico }}>
            <ContadorAnimado valor={criticos} />
          </span>
          <span>
            <span className="block text-[13px] font-extrabold uppercase tracking-[0.08em]" style={{ color: NIVEL_COLOR.critico }}>Crítico</span>
            <span className="text-xs font-medium text-txt-3">exige resposta imediata</span>
          </span>
        </div>
        <div className="card-hover flex items-center gap-4 rounded-[20px] border border-line bg-bg-1 px-5 py-4">
          <span className="tnum font-display text-[38px] font-bold leading-none" style={{ color: NIVEL_COLOR.alto }}>
            <ContadorAnimado valor={altos} />
          </span>
          <span>
            <span className="block text-[13px] font-extrabold uppercase tracking-[0.08em]" style={{ color: NIVEL_COLOR.alto }}>Alto</span>
            <span className="text-xs font-medium text-txt-3">acompanhar de perto</span>
          </span>
        </div>
        <div className="card-hover flex items-center gap-4 rounded-[20px] border border-line bg-bg-1 px-5 py-4">
          <IconAlertBell size={22} className="shrink-0" style={{ color: "#F97316" }} />
          <span>
            <span className="tnum block font-display text-[24px] font-bold leading-none text-txt-1">
              <ContadorAnimado valor={reais.length} />
            </span>
            <span className="text-xs font-medium text-txt-3">situações que precisam de atenção</span>
          </span>
        </div>
      </div>

      {reais.map((p) => {
        const cor = NIVEL_COLOR[(p.nivel as NivelCrise) ?? "alto"] ?? "#F97316";
        return (
          <div
            key={p.post_url}
            className="relative rounded-[16px] border border-line bg-bg-1 p-4 pl-6"
            style={{ boxShadow: "var(--shadow-ambient)" }}
          >
            {/* Espinha de severidade: a cor mora num fio, não no card inteiro. */}
            <span
              aria-hidden
              className="absolute left-0 top-3.5 bottom-3.5 w-1 rounded-full"
              style={{ background: cor }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="shrink-0 rounded px-2.5 py-0.5 text-xs font-extrabold uppercase"
                style={nivelBadgeStyle(cor)}
              >
                {NIVEL_LABEL[(p.nivel as NivelCrise) ?? "alto"] ?? p.nivel}
              </span>
              {/* Idade do alerta ao lado do nível: mesmo com o recorte por
                  janela, "há 6 dias" e "há 2 horas" pedem resposta diferente,
                  e o card não dizia qual era o caso. */}
              {p.gerado_em && (
                <span className="shrink-0 text-xs font-semibold text-txt-3">
                  {idadeDoAlerta(p.gerado_em)}
                </span>
              )}
              <span className="ml-auto text-xs font-bold text-txt-3">@{p.autor}</span>
            </div>

            {p.tema && (
              <div className="frase-cap mt-2 font-display text-[17px] font-bold text-txt-1">
                {p.tema}
              </div>
            )}
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-txt-2">
              <span className="font-bold text-txt-1">O que disparou: </span>
              {p.pavio}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AlertarSecretarioPlano p={p} />
              {p.post_url && (
                <a
                  href={p.post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white transition hover:opacity-90"
                  style={{ background: "linear-gradient(165deg, #55534E, #171613)" }}
                >
                  Ver post no Instagram ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 24h/7d/30d -> a chave de periodo com que o backend grava os briefings. */
function periodoParaChave(dias: number): "dia" | "semana" | "mes" {
  if (dias <= 1) return "dia";
  if (dias <= 7) return "semana";
  return "mes";
}

export function AlertasAcoesPage() {
  const [dias, setDias] = useState<Dias>(1);
  const periodo = periodoParaChave(dias);

  // periodo entra na queryKey: cada janela fica cacheada em separado, entao
  // voltar para uma ja visitada e instantaneo (mesmo padrao da ClimaPage).
  const { data: b, isLoading: loadBriefing } = useQuery({
    queryKey: ["briefing", periodo],
    queryFn: () => fetchBriefing(periodo),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  // `dias` entra na queryKey pelo mesmo motivo do briefing: os planos são
  // recortados pela janela selecionada (ver fetchCrisisPlans). Sem isso a tela
  // exibia plano de junho sob o cabeçalho "últimas 24 horas".
  const { data: planosData } = useQuery({
    queryKey: ["crisis-plans", dias],
    queryFn: () => fetchCrisisPlans(dias),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const planos = planosData ?? [];

  if (loadBriefing) return <EsqueletoPagina titulo="Alertas & Ações" />;

  const semBriefing = !b;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-semibold leading-tight tracking-tight">Alertas & Ações</h1>
          <p className="text-base text-txt-2">
            O que precisa de atenção e o que fazer · {periodoLabel(dias)}
          </p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} />
      </div>

      {semBriefing ? (
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda não há recomendações geradas para {periodoArtigo(dias)}. Tente outra
          janela acima ou execute o fluxo ÁGORA para popular esta página.
        </div>
      ) : (
        <>
          {/* Planos do Caçador de Crises */}
          <PlanosAcao planos={planos} dias={dias} />

          {(b!.oportunidades ?? []).length > 0 && (
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-risk-low">
                <span>▲</span> Oportunidades para aproveitar
              </div>
              <div className="space-y-3">
                {b!.oportunidades!.map((o, i) => (
                  <div key={i} className="rounded-lg border border-line bg-bg-2 p-3">
                    <div className="font-semibold text-txt-1">{o.titulo}</div>
                    <div className="mt-1 text-sm text-txt-2">{o.acao}</div>
                    {o.impacto && (
                      <div className="mt-2">
                        <Tag color={IMPACTO_COR[o.impacto] ?? "#5F6E8C"}>
                          impacto {o.impacto}
                        </Tag>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-txt-3">
            Gerado automaticamente a partir dos dados do dia ·{" "}
            {new Date(b!.gerado_em).toLocaleString("pt-BR", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        </>
      )}
    </div>
  );
}
