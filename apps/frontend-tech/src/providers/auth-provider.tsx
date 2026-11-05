import { createContext, useContext, useEffect } from 'react';

import type { PropsWithChildren } from 'react';

import { useCurrentUser } from '@/hooks/use-current-user';
import type { CurrentUser } from '@/lib/auth-client';
import { AUTH_LOGIN_URL } from '@/lib/auth-client';

import styles from './auth-provider.module.css';

const AuthContext = createContext<CurrentUser | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const { user, isPending, isUnauthorized, error } = useCurrentUser();

  useEffect(() => {
    if (isUnauthorized) {
      window.location.href = AUTH_LOGIN_URL;
    }
  }, [isUnauthorized]);

  if (isPending || isUnauthorized) {
    return (
      <div className={styles.fullscreen}>
        <span className={styles.spinner} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.fullscreen}>
        <p className={styles.errorText}>Не удалось подключиться к серверу</p>
        <button className={styles.retryBtn} onClick={() => window.location.reload()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={user}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthUser(): CurrentUser | undefined {
  return useContext(AuthContext);
}
