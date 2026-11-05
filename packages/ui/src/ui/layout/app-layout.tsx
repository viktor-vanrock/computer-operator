import type { PropsWithChildren } from 'react';

import { useTheme } from '../../hooks/use-theme';
import { Header } from '../header';
import type { HeaderNavItem, HeaderUser } from '../header/header.types';

import styles from './app-layout.module.css';

interface Props extends PropsWithChildren {
  logoHref: string;
  navItems: HeaderNavItem[];
  user?: HeaderUser | undefined;
  onLogout?: (() => void) | undefined;
  headerVariant?: 'default' | 'minimal' | undefined;
}

export function AppLayout({ children, logoHref, navItems, user, onLogout, headerVariant }: Props) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className={styles.layout}>
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        logoHref={logoHref}
        navItems={navItems}
        user={user}
        onLogout={onLogout}
        variant={headerVariant}
      />
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
