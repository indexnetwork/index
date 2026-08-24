'use client';
import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './dataroom-overview-body.html?raw';
import './dataroom-overview.css';

export default function DataroomOverviewPage() {
  return (
    <UnlistedDoc
      title="Index Network: The Social Discovery Protocol"
      scope="dro"
      bodyHtml={bodyHtml}
    />
  );
}

export const Component = DataroomOverviewPage;
