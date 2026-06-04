/**
 * Clima Político — lógica fiel ao dashboard antigo.
 * Mapeia o índice de aprovação (0-100) para uma condição climática.
 */

export interface WeatherCond {
  icon: string;
  label: string;
  sub: string;
  cls: string;
  bg: string; // gradiente de fundo
  dark: boolean; // fundo escuro => texto branco
}

export function getWeather(pct: number): WeatherCond {
  if (pct >= 75)
    return {
      icon: "☀️", label: "Céu Aberto", sub: "Clima excelente — opinião muito favorável",
      cls: "sunny",
      bg: "linear-gradient(155deg, #AEE0FF 0%, #CDEBFF 26%, #EAF2E0 52%, #FCEFA6 78%, #FFE074 100%)",
      dark: false,
    };
  if (pct >= 60)
    return {
      icon: "⛅", label: "Parcialmente Nublado", sub: "Clima estável — tendência positiva",
      cls: "partly",
      bg: "linear-gradient(155deg, #CDE8FF 0%, #DDEEFB 34%, #ECEFE6 66%, #FBEFC4 100%)",
      dark: false,
    };
  if (pct >= 45)
    return {
      icon: "☁️", label: "Nublado", sub: "Clima incerto — opiniões divididas",
      cls: "cloudy",
      bg: "linear-gradient(155deg, #EDEFF2 0%, #DEE1E6 40%, #CFD3DA 72%, #C2C7CF 100%)",
      dark: false,
    };
  if (pct >= 30)
    return {
      icon: "🌧️", label: "Chuva", sub: "Clima ruim — predominância negativa",
      cls: "rain",
      bg: "linear-gradient(155deg, #6E747C 0%, #565B63 38%, #41454C 70%, #2F3239 100%)",
      dark: true,
    };
  if (pct >= 15)
    return {
      icon: "⛈️", label: "Tempestade", sub: "Alerta máximo — crise de imagem detectada",
      cls: "storm",
      bg: "linear-gradient(155deg, #2C2F35 0%, #212429 36%, #16181C 70%, #0C0D10 100%)",
      dark: true,
    };
  return {
    icon: "🌑", label: "Severíssimo", sub: "Crise iminente — ação urgente necessária",
    cls: "severe",
    bg: "linear-gradient(155deg, #1A1C20 0%, #121316 38%, #0A0B0D 72%, #050506 100%)",
    dark: true,
  };
}

export function getDestaque(pct: number, tema: string): string {
  const t = tema ? `"${tema}"` : "temas locais";
  if (pct >= 70) return `A maioria aprova. Comentários positivos dominam, especialmente sobre ${t}.`;
  if (pct >= 55) return `Clima favorável. A opinião pública apoia a gestão, com destaque para ${t}.`;
  if (pct >= 45) return `Opiniões divididas. O debate gira em torno de ${t} — situação instável.`;
  if (pct >= 30) return `Clima de insatisfação. Críticas crescem, sobretudo sobre ${t}.`;
  return `Atenção: clima crítico. A maioria dos comentários é negativa — especialmente sobre ${t}.`;
}
