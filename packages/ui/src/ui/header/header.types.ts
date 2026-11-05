import type { Theme } from '../../types/theme.types';

export interface HeaderNavItem {
  label: string;
  to: string;
  end?: boolean;
}

export interface HeaderUser {
  name: string;
}

export interface HeaderProps {
  theme: Theme;
  onToggleTheme: () => void;
  logoHref: string;
  navItems: HeaderNavItem[];
  user?: HeaderUser | undefined;
  onLogout?: (() => void) | undefined;
  variant?: 'default' | 'minimal' | undefined;
}
