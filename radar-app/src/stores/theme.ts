import { create } from "zustand";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const inicial: Theme =
  (typeof localStorage !== "undefined" && (localStorage.getItem("radar_theme") as Theme)) || "dark";

export const useThemeStore = create<ThemeState>((set) => ({
  theme: inicial,
  setTheme: (theme) => set({ theme }),
  toggle: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
}));
