import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@x10/shared/runtime';

import { AboutPage } from './pages/AboutPage';
import { CheckInEntry } from './pages/CheckInEntryPage';
import { CheckInPage } from './pages/CheckInPage';
import { NewSessionPage } from './pages/NewSessionPage';
import { HomeRoute, HostRoute } from './pages/PulsePage';
import { ReportPage } from './pages/ReportPage';
import { SessionsPage } from './pages/SessionsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/host/:id" element={<HostRoute />} />
      <Route path="/checkin" element={<AppShell><CheckInEntry /></AppShell>} />
      <Route path="/join/:code" element={<AppShell><CheckInPage /></AppShell>} />
      <Route path="/sessions" element={<AppShell><SessionsPage /></AppShell>} />
      <Route path="/new" element={<AppShell><NewSessionPage /></AppShell>} />
      <Route path="/report/:id" element={<AppShell><ReportPage /></AppShell>} />
      <Route path="/about" element={<AppShell><AboutPage /></AppShell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
