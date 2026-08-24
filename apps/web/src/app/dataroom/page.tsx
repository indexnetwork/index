'use client';
import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './dataroom-body.html?raw';
import './dataroom.css';

export default function DataroomPage() {
  return <UnlistedDoc title="Dataroom | Index Network" scope="drm" bodyHtml={bodyHtml} />;
}

export const Component = DataroomPage;
