/**
 * Reports & Analytics page (sidebar "Reports & Analytics", view id `analytics`).
 * The real reports live in src/features/reports/ReportsView.tsx: sales forecast, pipeline health, deal actions,
 * customer segments and lead source conversion, all from GET /api/reports/*. The former placeholder panels
 * (empty channel tables) and the unrelated free-time finder and simulated speaker grid are gone from this page.
 */
import React from 'react';
import ReportsView from '../features/reports/ReportsView';

export default function AnalyticsView({ onNavigate }: { onNavigate?: (view: string) => void }) {
  return <ReportsView onNavigate={onNavigate} />;
}
