'use client';
import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './edge-city-metrics-body.html?raw';
import './edge-city-metrics.css';

export default function EdgeCityMetricsPage() {
  return (
    <UnlistedDoc
      title="Edge City Experiment Results | Index Network"
      scope="ecm"
      bodyHtml={bodyHtml}
    />
  );
}

export const Component = EdgeCityMetricsPage;
