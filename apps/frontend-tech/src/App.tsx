import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@arena/ui/ui/layout/app-layout';

import { ROUTES } from './constants/routes';
import { ArenaPage } from './features/arena';
import { ResultsPage } from './features/results';
import { TaskManagementPage } from './features/task-management';
import { TaskSelectionPage } from './features/task-selection';
import { AUTH_LOGOUT_URL } from './lib/auth-client';
import { AuthProvider, useAuthUser } from './providers/auth-provider';

const NAV_ITEMS = [
  { label: 'SOLO', to: ROUTES.TASKS_SOLO },
  { label: 'Человек vs агент', to: ROUTES.TASKS_HUMAN_AGENT },
  { label: 'Full Duplex', to: ROUTES.TASKS_FULL_DUPLEX },
  { label: 'Задачи', to: ROUTES.TASK_MANAGEMENT },
];

function handleLogout() {
  window.location.href = AUTH_LOGOUT_URL;
}

function AppContent() {
  const user = useAuthUser();
  const headerUser = user ? { name: user.name || user.preferredUsername || user.email } : undefined;

  return (
    <AppLayout logoHref={ROUTES.TASKS_FULL_DUPLEX} navItems={NAV_ITEMS} user={headerUser} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<Navigate to={ROUTES.TASKS_FULL_DUPLEX} replace />} />
        <Route path={ROUTES.TASKS} element={<Navigate to={ROUTES.TASKS_FULL_DUPLEX} replace />} />
        <Route path="/tasks/:mode" element={<TaskSelectionPage />} />
        <Route path={ROUTES.TASK_MANAGEMENT} element={<TaskManagementPage />} />
        <Route path={ROUTES.ARENA}>
          <Route index element={<ArenaPage />} />
          <Route path="results" element={<ResultsPage />} />
        </Route>
        <Route path="*" element={<Navigate to={ROUTES.TASKS_FULL_DUPLEX} replace />} />
      </Routes>
    </AppLayout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
