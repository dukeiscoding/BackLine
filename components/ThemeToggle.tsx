"use client";

import { useEffect, useState } from "react";

type ThemeName = "night" | "high" | "split" | "ahead";

export const STORAGE_KEY = "backline-theme";

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function getStoredTheme(): ThemeName {
  const saved = (localStorage.getItem(STORAGE_KEY) as ThemeName | null) ?? "night";
  return saved === "high" || saved === "split" || saved === "ahead" ? saved : "night";
}

type ThemeToggleProps = {
  className?: string;
};

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<ThemeName>("night");

  useEffect(() => {
    const next = getStoredTheme();
    setTheme(next);
    applyTheme(next);
  }, []);

  function toggleTheme() {
    const next: ThemeName =
      theme === "night" ? "high" : theme === "high" ? "split" : theme === "split" ? "ahead" : "night";
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <button
      aria-label="Cycle theme"
      className={`ts-button rounded px-3 py-2 text-sm font-medium ${className ?? ""}`}
      onClick={toggleTheme}
      type="button"
    >
      Theme: {theme === "night" ? "Collider" : theme === "high" ? "Moving on" : theme === "split" ? "Split" : "What lies ahead"}
    </button>
  );
}
