import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppLayout } from '@arena/ui/ui/layout/app-layout';

import { ROUTES } from './constants/routes';
import { ArenaPage, TaskSelectionPage } from './features';

export function App() {
  return (
    <AppLayout logoHref={ROUTES.TASK_SELECTION} navItems={[]} headerVariant="minimal">
      <Routes>
        <Route path={ROUTES.TASK_SELECTION} element={<SoloTaskSelection />} />
        <Route path={ROUTES.LEGACY_TASK_SELECTION} element={<LegacyTaskRedirect />} />
        <Route path={ROUTES.RESULTS} element={<Navigate to={ROUTES.TASK_SELECTION} replace />} />
        <Route path={ROUTES.ARENA} element={<ArenaPage />} />
        <Route path="*" element={<Navigate to={ROUTES.TASK_SELECTION} replace />} />
      </Routes>
    </AppLayout>
  );
}

function LegacyTaskRedirect() {
  return <Navigate to={ROUTES.TASK_SELECTION} replace />;
}

function SoloTaskSelection() {
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  if (query.has('mode')) {
    query.delete('mode');
    const remaining = query.toString();
    return <Navigate to={`${ROUTES.TASK_SELECTION}${remaining ? `?${remaining}` : ''}`} replace />;
  }
  return <TaskSelectionPage />;
}
