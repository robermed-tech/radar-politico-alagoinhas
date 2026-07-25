import type { ProfileMetric } from "@/lib/data";

/**
 * Ranking de seguidores por perfil monitorado.
 *
 * O que o Instagram publica de uma conta é APENAS o total de seguidores: não
 * existe API pública que diga quem entrou ou quem saiu. Por isso tudo aqui é
 * SALDO (líquido) entre dois retratos da série: "ganhou 312" significa que o
 * total subiu 312 no intervalo, não que 312 pessoas novas seguiram e ninguém
 * saiu. A tela diz isso com todas as letras para não vender medição que a
 * plataforma não entrega.
 */
export interface PerfilSeguidores {
  handle: string;
  categoria: string;
  seguidores: number;
  seguindo: number;
  publicacoes: number;
  /** Timestamp ISO do retrato mais recente deste perfil. */
  atualizadoEm: string;
  /** Saldo desde o retrato imediatamente anterior (null se só há um ponto). */
  deltaColeta: number | null;
  /** Saldo nas últimas 24h e 7 dias (null quando a série não cobre a janela). */
  delta24h: number | null;
  delta7d: number | null;
  /** Série cronológica completa, para o gráfico de evolução. */
  serie: { t: number; v: number }[];
}

const H = 3600 * 1000;

/**
 * Valor do último ponto com t <= alvo. Retorna null quando a série começa
 * depois do alvo: nesse caso a janela não é comparável e a tela mostra "sem
 * base de comparação" em vez de inventar um saldo a partir do ponto mais
 * antigo (o que exibiria a série inteira como se fosse ganho de 24h).
 */
function valorEm(serie: { t: number; v: number }[], alvo: number): number | null {
  let achado: number | null = null;
  for (const p of serie) {
    if (p.t <= alvo) achado = p.v;
    else break;
  }
  return achado;
}

/** Agrupa os pontos por perfil e calcula totais e saldos por janela. */
export function montarRanking(metrics: ProfileMetric[]): PerfilSeguidores[] {
  const porHandle = new Map<string, ProfileMetric[]>();
  for (const m of metrics) {
    if (!m.handle || !m.seguidores) continue;
    const lista = porHandle.get(m.handle) ?? [];
    lista.push(m);
    porHandle.set(m.handle, lista);
  }

  const perfis: PerfilSeguidores[] = [];
  for (const [handle, pontos] of porHandle) {
    const serie = pontos
      .map((p) => ({ t: new Date(p.coletado_em).getTime(), v: p.seguidores }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    if (serie.length === 0) continue;

    const ultimo = serie[serie.length - 1];
    const anterior = serie.length > 1 ? serie[serie.length - 2] : null;
    const base24 = valorEm(serie, ultimo.t - 24 * H);
    const base7d = valorEm(serie, ultimo.t - 7 * 24 * H);
    // O registro mais recente carrega os demais contadores (seguindo/posts).
    const recente = pontos.reduce((a, b) =>
      new Date(a.coletado_em) >= new Date(b.coletado_em) ? a : b
    );

    perfis.push({
      handle,
      categoria: recente.categoria,
      seguidores: ultimo.v,
      seguindo: recente.seguindo,
      publicacoes: recente.publicacoes,
      atualizadoEm: recente.coletado_em,
      deltaColeta: anterior ? ultimo.v - anterior.v : null,
      delta24h: base24 === null ? null : ultimo.v - base24,
      delta7d: base7d === null ? null : ultimo.v - base7d,
      serie,
    });
  }

  return perfis.sort((a, b) => b.seguidores - a.seguidores);
}

/** "há 12 min", "há 3 h", "há 2 dias" — sem travessão, sentence case. */
export function desdeQuando(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Formata um saldo com sinal explícito ("+312", "-87", "0"). */
export function fmtSaldo(v: number): string {
  const abs = new Intl.NumberFormat("pt-BR").format(Math.abs(v));
  if (v > 0) return `+${abs}`;
  if (v < 0) return `-${abs}`;
  return "0";
}
