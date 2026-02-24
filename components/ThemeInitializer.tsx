"use client";

import { useEffect } from "react";
import { applyTheme, STORAGE_KEY } from "@/components/ThemeToggle";

type ThemeName = "night" | "high" | "split" | "ahead";

export default function ThemeInitializer() {
  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemeName | null) ?? "night";
    const next = saved === "high" || saved === "split" || saved === "ahead" ? saved : "night";
    applyTheme(next);
  }, []);

  return null;
}
