import { Link, NavLink } from 'react-router-dom';

import { MoonIcon, SignOutIcon, SunIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';

import type { HeaderProps } from './header.types';
import { Logo } from './Logo';

import styles from './header.module.css';

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`;

export function Header({ theme, onToggleTheme, logoHref, navItems, user, onLogout, variant = 'default' }: HeaderProps) {
  return (
    <header className={`${styles.header}${'minimal' === variant ? ` ${styles.minimal}` : ''}`} role="banner">
      <Link to={logoHref} className={styles.logoLink} aria-label="UI-Agent Arena — на главную">
        <Logo size="lg" />
      </Link>

      {navItems.length > 0 ? (
        <nav className={styles.nav} aria-label="Основная навигация">
          {navItems.map(({ label, to, end }) => (
            <NavLink key={to} to={to} end={end ?? false} className={navLinkClassName}>
              {label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <div className={styles.actions}>
        {user && (
          <div className={styles.userSection}>
            <span className={styles.userBadge} title={user.name}>
              {user.name}
            </span>
            {onLogout && (
              <button className={styles.logoutBtn} onClick={onLogout} title="Выйти">
                <SignOutIcon weight="regular" size={18} />
              </button>
            )}
          </div>
        )}
        <button
          className={styles.themeBtn}
          onClick={onToggleTheme}
          aria-label={'dark' === theme ? 'Включить светлую тему' : 'Включить тёмную тему'}
          title={'dark' === theme ? 'Светлая тема' : 'Тёмная тема'}
        >
          <AnimatePresence mode="wait" initial={false}>
            {'dark' === theme
              ? (
                <motion.span
                  key="sun"
                  initial={{ opacity: 0, rotate: -30 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={{ opacity: 0, rotate: 30 }}
                  transition={{ duration: 0.15 }}
                >
                  <SunIcon weight="fill" size={20} />
                </motion.span>
              )
              : (
                <motion.span
                  key="moon"
                  initial={{ opacity: 0, rotate: 30 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={{ opacity: 0, rotate: -30 }}
                  transition={{ duration: 0.15 }}
                >
                  <MoonIcon weight="fill" size={20} />
                </motion.span>
              )}
          </AnimatePresence>
        </button>
      </div>
    </header>
  );
}
