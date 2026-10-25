import React from 'react';
import { TimeRange } from '../types';
import { useLocalSeo } from '../live/localSeoClient';
import { LivePerformanceView } from '../live/LivePerformanceView';

export interface VisibilityChartProps { selectedRange?: TimeRange; [key: string]: any }

/** Dashboard card: real Performance API data for the selected location. */
export const VisibilityChart: React.FC<VisibilityChartProps> = () => {
  const seo = useLocalSeo();
  const loc = seo.locations[0] && (seo as any).selectedId ? seo.locations.find((l) => l.id === (seo as any).selectedId) : seo.locations[0];
  return <LivePerformanceView location={loc} compact />;
};

export default VisibilityChart;
