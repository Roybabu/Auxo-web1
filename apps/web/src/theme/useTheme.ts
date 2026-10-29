import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "dark" | "light";

const STORAGE_KEY = "auxo:theme";

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to system.
  }
  return "system";
}

function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

export function useTheme(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());

  useEffect(() => {
    applyPreference(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Ignore write failures; the in-memory preference still applies this session.
    }
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
  }, []);

  return [preference, setTheme];
}
