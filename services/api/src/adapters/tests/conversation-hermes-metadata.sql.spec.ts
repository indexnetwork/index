import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { buildHermesResponseMetadataSql, buildNegotiationParkMetadataSql } from '../conversation-hermes-metadata.sql';

const dialect = new PgDialect();
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('Hermes metadata raw SQL bindings', () => {
  it('casts the standalone park generation through the real PostgreSQL dialect', () => {
    const rendered = dialect.sqlToQuery(buildNegotiationParkMetadataSql('park-generation-1'));

    expect(normalize(rendered.sql)).toContain(
      `'negotiationParkGeneration', $1::text`,
    );
    expect(rendered.params).toEqual(['park-generation-1']);
    expect(rendered.params.filter((value) => value instanceof Date)).toEqual([]);
  });

  for (const values of [
    {
      label: 'parked response strings',
      parkGeneration: 'receipt-1',
      parkStartedAt: '2026-08-09T12:00:00.000Z',
    },
    {
      label: 'terminal response nulls',
      parkGeneration: null,
      parkStartedAt: null,
    },
  ] as const) {
    it(`casts ${values.label} without Date parameters`, () => {
      const completedBinding = { runId: 'run-1', completedAt: '2026-08-09T12:00:00.000Z' };
      const receipt = { version: 1, receiptId: 'receipt-1' };
      const rendered = dialect.sqlToQuery(buildHermesResponseMetadataSql({
        completedBinding,
        receipt,
        parkGeneration: values.parkGeneration,
        parkStartedAt: values.parkStartedAt,
      }));
      const text = normalize(rendered.sql);

      expect(text).toContain(`'hermesRunCapability', $1::jsonb`);
      expect(text).toContain(`'hermesResponseReceipt', $2::jsonb`);
      expect(text).toContain(`'negotiationParkGeneration', $3::text`);
      expect(text).toContain(`'hermesParkStartedAt', $4::text`);
      expect(rendered.params).toEqual([
        JSON.stringify(completedBinding),
        JSON.stringify(receipt),
        values.parkGeneration,
        values.parkStartedAt,
      ]);
      expect(rendered.params.filter((value) => value instanceof Date)).toEqual([]);
    });
  }
});
