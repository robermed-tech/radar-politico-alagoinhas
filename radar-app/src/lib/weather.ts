/**
 * Clima Político — lógica fiel ao dashboard antigo.
 * Mapeia o índice de aprovação (0-100) para uma condição climática.
 */

export interface WeatherCond {
  label: string;
  sub: string;
  cls: string;
  bg: string;       // gradiente do hero do Clima (fallback se a foto não carregar)
  bgApp: string;    // gradiente ESCURO p/ background global no tema DARK
  bgLight: string;  // gradiente CLARO p/ background global no tema LIGHT (texto escuro)
  image: string;    // foto de céu do hero (public/sky/*.jpg)
  accent: string;   // cor de destaque do clima
  dark: boolean;
  heroDark: boolean;
}

export function getWeather(pct: number): WeatherCond {
  if (pct >= 75)
    return {
      label: "Céu Aberto", sub: "Clima excelente — opinião muito favorável",
      cls: "sunny",
      bg: "linear-gradient(155deg, #AEE0FF 0%, #CDEBFF 26%, #EAF2E0 52%, #FCEFA6 78%, #FFE074 100%)",
      bgApp: "linear-gradient(160deg, #06243F 0%, #0A3358 30%, #0E4D7A 60%, #0B2E4E 100%)",
      bgLight: "linear-gradient(160deg, #E8F4FF 0%, #F3F8FF 45%, #FFF8E6 100%)",
      image: "/sky/sunny.webp",
      accent: "#38BDF8", dark: true, heroDark: false,
    };
  if (pct >= 60)
    return {
      label: "Parcialmente Nublado", sub: "Clima estável — tendência positiva",
      cls: "partly",
      bg: "linear-gradient(155deg, #CDE8FF 0%, #DDEEFB 34%, #ECEFE6 66%, #FBEFC4 100%)",
      bgApp: "linear-gradient(160deg, #0B1E44 0%, #122A5E 35%, #1E3A6E 70%, #0E1E40 100%)",
      bgLight: "linear-gradient(160deg, #EAF2FF 0%, #F1F5FB 50%, #F6F4EC 100%)",
      image: "/sky/partly.webp",
      accent: "#60A5FA", dark: true, heroDark: false,
    };
  if (pct >= 45)
    return {
      label: "Nublado", sub: "Clima incerto — opiniões divididas",
      cls: "cloudy",
      bg: "linear-gradient(155deg, #EDEFF2 0%, #DEE1E6 40%, #CFD3DA 72%, #C2C7CF 100%)",
      bgApp: "linear-gradient(160deg, #1A1F2B 0%, #232A38 38%, #2C3445 70%, #161A24 100%)",
      bgLight: "linear-gradient(160deg, #EEF1F5 0%, #E6EAF0 50%, #DDE3EB 100%)",
      image: "/sky/cloudy.webp",
      accent: "#94A3B8", dark: true, heroDark: false,
    };
  if (pct >= 30)
    return {
      label: "Chuva", sub: "Clima ruim — predominância negativa",
      cls: "rain",
      bg: "linear-gradient(155deg, #6E747C 0%, #565B63 38%, #41454C 70%, #2F3239 100%)",
      bgApp: "linear-gradient(160deg, #14202E 0%, #18293A 38%, #1B3147 70%, #0E1822 100%)",
      bgLight: "linear-gradient(160deg, #E6EDF3 0%, #DEE7EF 50%, #D6E1EB 100%)",
      image: "/sky/rain.webp",
      accent: "#38BDF8", dark: true, heroDark: true,
    };
  if (pct >= 15)
    return {
      label: "Tempestade", sub: "Alerta máximo — crise de imagem detectada",
      cls: "storm",
      bg: "linear-gradient(155deg, #2C2F35 0%, #212429 36%, #16181C 70%, #0C0D10 100%)",
      bgApp: "linear-gradient(160deg, #1A0E2E 0%, #201038 38%, #2A0F4E 70%, #120720 100%)",
      bgLight: "linear-gradient(160deg, #EFEAF5 0%, #E7E0F0 50%, #DFD6EC 100%)",
      image: "/sky/storm.webp",
      accent: "#8B5CF6", dark: true, heroDark: true,
    };
  return {
    label: "Severíssimo", sub: "Crise iminente — ação urgente necessária",
    cls: "severe",
    bg: "linear-gradient(155deg, #1A1C20 0%, #121316 38%, #0A0B0D 72%, #050506 100%)",
    bgApp: "linear-gradient(160deg, #1A0410 0%, #200512 38%, #2A0818 70%, #120308 100%)",
    bgLight: "linear-gradient(160deg, #F6E9ED 0%, #F0DEE4 50%, #EAD6DD 100%)",
    image: "/sky/severe.webp",
    accent: "#EF4444", dark: true, heroDark: true,
  };
}

/**
 * Condição climática a partir do `condicao` do boletim (gerado no backend),
 * sem expor o score numérico. Usado na visão do usuário comum.
 */
/*
 * Removido na auditoria de 26/07: `weatherFromCondicao` traduzia a condição do
 * boletim (escala de RISCO, alto é ruim) para a mesma metáfora visual que
 * `getWeather` monta a partir do IAD (escala de APROVAÇÃO, alto é bom).
 *
 * Como só o usuário comum passava por essa tradução, admin e cliente podiam
 * ver climas diferentes para o mesmo dia. O clima agora sai de um lugar só
 * (`getWeather(iad)`); a condição do boletim continua sendo exibida onde ela
 * é a informação certa, sem competir com o clima. Não reintroduzir uma
 * segunda fonte de clima sem resolver a diferença de grandeza.
 */

export function getDestaque(pct: number, tema: string): string {
  const t = tema ? `"${tema}"` : "temas locais";
  if (pct >= 70) return `A maioria aprova. Comentários positivos dominam, especialmente sobre ${t}.`;
  if (pct >= 55) return `Clima favorável. A opinião pública apoia a gestão, com destaque para ${t}.`;
  if (pct >= 45) return `Opiniões divididas. O debate gira em torno de ${t} — situação instável.`;
  if (pct >= 30) return `Clima de insatisfação. Críticas crescem, sobretudo sobre ${t}.`;
  return `Atenção: clima crítico. A maioria dos comentários é negativa — especialmente sobre ${t}.`;
}
