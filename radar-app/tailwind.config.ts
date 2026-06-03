import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { 0: "#0B0F17", 1: "#121826", 2: "#1A2233", 3: "#232E44" },
        line: { DEFAULT: "#2A364E", strong: "#3A496B" },
        txt: { 1: "#EAF0FA", 2: "#9FB0CC", 3: "#5F6E8C" },
        brand: { DEFAULT: "#3B82F6", 2: "#06B6D4" },
        accent: "#A855F7",
        risk: { low: "#22C55E", mod: "#EAB308", high: "#F97316", crit: "#EF4444" },
        sent: { pos: "#22C55E", neu: "#64748B", neg: "#EF4444" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
