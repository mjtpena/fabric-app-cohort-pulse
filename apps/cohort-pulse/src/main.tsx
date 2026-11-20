import type { ReactNode } from 'react';
import { Activity, CalendarRange, CirclePlus, Hand, Info } from 'lucide-react';

import { mountApp } from '@x10/shared/runtime';

import { App } from './App';
import { config } from './app.config';
import './index.css';

/** Phone tab-bar icons live here so app.config.ts stays JSX-free (tools load it in Node). */
const ICONS: Record<string, ReactNode> = {
  '/': <Activity />,
  '/checkin': <Hand />,
  '/sessions': <CalendarRange />,
  '/new': <CirclePlus />,
  '/about': <Info />,
};

mountApp({ ...config, nav: config.nav.map((n) => ({ ...n, icon: ICONS[n.to] })) }, <App />);
