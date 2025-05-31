// Create this file: src/components/theme-provider.jsx
import React, { createContext, useContext, useEffect, useState } from "react";

const initialState = {
  theme: "system", // Default initial state
  setTheme: () => null,
};

const ThemeProviderContext = createContext(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme", // Default storage key from docs
  ...props
}) {
  const [theme, setThemeState] = useState( // Renamed internal setter
    () => (localStorage.getItem(storageKey)) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      // console.log(`ThemeProvider: System theme detected as ${systemTheme}. Applying.`);
      return;
    }

    root.classList.add(theme);
    // console.log(`ThemeProvider: Applying theme: ${theme}`);
  }, [theme]);

  const value = {
    theme,
    setTheme: (newThemeValue) => { // Renamed parameter to avoid conflict
      localStorage.setItem(storageKey, newThemeValue);
      setThemeState(newThemeValue);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};