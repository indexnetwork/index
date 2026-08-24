'use client';
import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './dataroom-demo-body.html?raw';
import './dataroom-demo.css';

export default function DataroomDemoPage() {
  return <UnlistedDoc title="Demo in action | Index Network" scope="dmo" bodyHtml={bodyHtml} />;
}

export const Component = DataroomDemoPage;
