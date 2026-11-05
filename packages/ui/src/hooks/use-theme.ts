import { useCallback, useLayoutEffect, useState } from 'react';

import { THEME_STORAGE_KEY } from '../constants/theme';
import type { Theme } from '../types/theme.types';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if ('light' === stored || 'dark' === stored) return stored;
  } catch {
    // localStorage недоступен (SSR / приватный режим)
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // useLayoutEffect: применяем до отрисовки — устраняем FOUC
  useLayoutEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // игнорируем ошибки записи
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => ('light' === prev ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme } as const;
}
