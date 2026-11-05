import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppLayout } from '@arena/ui/ui/layout/app-layout';

import { ROUTES } from './constants/routes';
import { ArenaPage, TaskSelectionPage } from './features';
import { ResultsPage } from './features/results';

export function App() {
  return (
    <AppLayout logoHref={ROUTES.TASK_SELECTION} navItems={[
      { label: 'Задание агенту', to: ROUTES.TASK_SELECTION, end: true },
      { label: 'Человек vs агент', to: ROUTES.HUMAN_AGENT },
    ]} headerVariant="minimal">
      <Routes>
        <Route path={ROUTES.TASK_SELECTION} element={<TaskSelectionRoute mode="SOLO" />} />
        <Route path={ROUTES.HUMAN_AGENT} element={<TaskSelectionRoute mode="HUMAN_VS_AGENT" />} />
        <Route path={ROUTES.LEGACY_TASK_SELECTION} element={<LegacyTaskRedirect />} />
        <Route path={ROUTES.RESULTS} element={<ResultsPage />} />
        <Route path={ROUTES.ARENA} element={<ArenaPage />} />
        <Route path="*" element={<Navigate to={ROUTES.TASK_SELECTION} replace />} />
      </Routes>
    </AppLayout>
  );
}

function LegacyTaskRedirect() {
  return <Navigate to={ROUTES.TASK_SELECTION} replace />;
}

function TaskSelectionRoute({ mode }: { mode: 'SOLO' | 'HUMAN_VS_AGENT' }) {
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  if (query.has('mode')) {
    query.delete('mode');
    const remaining = query.toString();
    return <Navigate to={`${ROUTES.TASK_SELECTION}${remaining ? `?${remaining}` : ''}`} replace />;
  }
  return <TaskSelectionPage mode={mode} />;
}
