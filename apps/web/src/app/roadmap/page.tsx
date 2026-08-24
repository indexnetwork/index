'use client';
import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './roadmap-body.html?raw';
import './roadmap.css';

export default function RoadmapPage() {
  return <UnlistedDoc title="Roadmap | Index Network" scope="rdm" bodyHtml={bodyHtml} />;
}

export const Component = RoadmapPage;
