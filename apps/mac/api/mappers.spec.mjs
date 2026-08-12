import { describe, expect, it } from 'bun:test';

import { applyMappedIntentStatus, mapIntent } from './mappers.mjs';

describe('applyMappedIntentStatus', () => {
  const active = mapIntent({ id: 'i1', summary: 'find designers', status: 'ACTIVE' });
  const other = mapIntent({ id: 'i2', summary: 'find founders', status: 'ACTIVE' });

  it('marks one mapped signal paused without touching siblings', () => {
    const next = applyMappedIntentStatus([active, other], 'i1', 'paused');
    expect(next.find((i) => i.id === 'i1').status).toBe('paused');
    expect(next.find((i) => i.id === 'i2').status).toBe('active');
  });

  it('marks one mapped signal archived so the hub can drop it', () => {
    const next = applyMappedIntentStatus([active, other], 'i1', 'archived');
    expect(next.find((i) => i.id === 'i1').status).toBe('archived');
    expect(next.find((i) => i.id === 'i2').status).toBe('active');
  });

  it('resumes a paused signal back to active', () => {
    const paused = mapIntent({ id: 'i1', summary: 'find designers', status: 'PAUSED' });
    const next = applyMappedIntentStatus([paused], 'i1', 'active');
    expect(next[0].status).toBe('active');
  });

  it('returns the same list when the id is missing', () => {
    const list = [active, other];
    expect(applyMappedIntentStatus(list, 'missing', 'paused')).toBe(list);
  });
});
