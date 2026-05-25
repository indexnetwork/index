/**
 * Compile-time structural alignment tests.
 *
 * Each adapter defines its own local types (no import from protocol interfaces).
 * These tests verify that local adapter types remain structurally assignable to
 * the canonical protocol interface contracts, catching drift at compile time.
 *
 * If a test fails to compile, it means an adapter's local type has diverged from
 * the protocol interface it must satisfy.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';

// ─────────────────────────────────────────────────────────────────────────────
// Protocol interface types (the canonical contracts)
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Cache as ProtocolCache,
  CacheOptions as ProtocolCacheOptions,
} from '@indexnetwork/protocol';

import type {
  LensEmbedding as ProtocolLensEmbedding,
  HydeSearchOptions as ProtocolHydeSearchOptions,
  ProfileEmbeddingSearchOptions as ProtocolProfileEmbeddingSearchOptions,
  HydeCandidate as ProtocolHydeCandidate,
  VectorSearchResult as ProtocolVectorSearchResult,
  VectorStoreOption as ProtocolVectorStoreOption,
} from '@indexnetwork/protocol';

import type {
  IntegrationAdapter as ProtocolIntegrationAdapter,
  IntegrationSession as ProtocolIntegrationSession,
  IntegrationSessionOptions as ProtocolIntegrationSessionOptions,
  ToolActionResponse as ProtocolToolActionResponse,
  IntegrationConnection as ProtocolIntegrationConnection,
} from '@indexnetwork/protocol';

import type {
  UserDatabase as ProtocolUserDatabase,
  SystemDatabase as ProtocolSystemDatabase,
} from '@indexnetwork/protocol';

import type {
  QuestionerDatabase as ProtocolQuestionerDatabase,
  PersistableQuestion as ProtocolPersistableQuestion,
  PersistedQuestion as ProtocolPersistedQuestion,
  QuestionFilters as ProtocolQuestionFilters,
} from '@indexnetwork/protocol';

// ─────────────────────────────────────────────────────────────────────────────
// Adapter local types (the structurally-aligned copies)
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Cache as AdapterCache,
  CacheOptions as AdapterCacheOptions,
} from '../cache.adapter';

import type {
  LensEmbedding as AdapterLensEmbedding,
  ProfileEmbeddingSearchOptions as AdapterProfileEmbeddingSearchOptions,
  HydeSearchOptions as AdapterHydeSearchOptions,
  HydeCandidate as AdapterHydeCandidate,
  VectorSearchResult as AdapterVectorSearchResult,
  VectorStoreOption as AdapterVectorStoreOption,
} from '../embedder.adapter';

import type {
  IntegrationAdapter as AdapterIntegrationAdapter,
  IntegrationSession as AdapterIntegrationSession,
  IntegrationSessionOptions as AdapterIntegrationSessionOptions,
  ToolActionResponse as AdapterToolActionResponse,
  IntegrationConnection as AdapterIntegrationConnection,
} from '../integration.adapter';

import {
  createUserDatabase,
  createSystemDatabase,
} from '../database.adapter';

import type {
  AdapterPersistableQuestion,
  AdapterPersistedQuestion,
  AdapterQuestionFilters,
} from '../questioner.adapter';
import { QuestionerAdapter } from '../questioner.adapter';

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cache adapter ↔ protocol interface alignment', () => {
  it('CacheOptions: adapter → protocol', () => {
    const check: (_: AdapterCacheOptions) => ProtocolCacheOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('CacheOptions: protocol → adapter', () => {
    const check: (_: ProtocolCacheOptions) => AdapterCacheOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('Cache: adapter → protocol', () => {
    const check: (_: AdapterCache) => ProtocolCache = (v) => v;
    expect(check).toBeDefined();
  });

  it('Cache: protocol → adapter', () => {
    const check: (_: ProtocolCache) => AdapterCache = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDER ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Embedder adapter ↔ protocol interface alignment', () => {
  it('LensEmbedding: adapter → protocol', () => {
    const check: (_: AdapterLensEmbedding) => ProtocolLensEmbedding = (v) => v;
    expect(check).toBeDefined();
  });

  it('LensEmbedding: protocol → adapter', () => {
    const check: (_: ProtocolLensEmbedding) => AdapterLensEmbedding = (v) => v;
    expect(check).toBeDefined();
  });

  it('HydeSearchOptions: adapter → protocol', () => {
    const check: (_: AdapterHydeSearchOptions) => ProtocolHydeSearchOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('HydeSearchOptions: protocol → adapter', () => {
    const check: (_: ProtocolHydeSearchOptions) => AdapterHydeSearchOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('ProfileEmbeddingSearchOptions: adapter → protocol', () => {
    const check: (_: AdapterProfileEmbeddingSearchOptions) => ProtocolProfileEmbeddingSearchOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('ProfileEmbeddingSearchOptions: protocol → adapter', () => {
    const check: (_: ProtocolProfileEmbeddingSearchOptions) => AdapterProfileEmbeddingSearchOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('HydeCandidate: adapter → protocol', () => {
    const check: (_: AdapterHydeCandidate) => ProtocolHydeCandidate = (v) => v;
    expect(check).toBeDefined();
  });

  it('HydeCandidate: protocol → adapter', () => {
    const check: (_: ProtocolHydeCandidate) => AdapterHydeCandidate = (v) => v;
    expect(check).toBeDefined();
  });

  it('VectorSearchResult: adapter → protocol', () => {
    const check: (_: AdapterVectorSearchResult<unknown>) => ProtocolVectorSearchResult<unknown> = (v) => v;
    expect(check).toBeDefined();
  });

  it('VectorSearchResult: protocol → adapter', () => {
    const check: (_: ProtocolVectorSearchResult<unknown>) => AdapterVectorSearchResult<unknown> = (v) => v;
    expect(check).toBeDefined();
  });

  it('VectorStoreOption: adapter → protocol', () => {
    const check: (_: AdapterVectorStoreOption<unknown>) => ProtocolVectorStoreOption<unknown> = (v) => v;
    expect(check).toBeDefined();
  });

  it('VectorStoreOption: protocol → adapter', () => {
    const check: (_: ProtocolVectorStoreOption<unknown>) => AdapterVectorStoreOption<unknown> = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration adapter ↔ protocol interface alignment', () => {
  it('IntegrationSession: adapter → protocol', () => {
    const check: (_: AdapterIntegrationSession) => ProtocolIntegrationSession = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationSession: protocol → adapter', () => {
    const check: (_: ProtocolIntegrationSession) => AdapterIntegrationSession = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationSessionOptions: adapter → protocol', () => {
    const check: (_: AdapterIntegrationSessionOptions) => ProtocolIntegrationSessionOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationSessionOptions: protocol → adapter', () => {
    const check: (_: ProtocolIntegrationSessionOptions) => AdapterIntegrationSessionOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('ToolActionResponse: adapter → protocol', () => {
    const check: (_: AdapterToolActionResponse) => ProtocolToolActionResponse = (v) => v;
    expect(check).toBeDefined();
  });

  it('ToolActionResponse: protocol → adapter', () => {
    const check: (_: ProtocolToolActionResponse) => AdapterToolActionResponse = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationConnection: adapter → protocol', () => {
    const check: (_: AdapterIntegrationConnection) => ProtocolIntegrationConnection = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationConnection: protocol → adapter', () => {
    const check: (_: ProtocolIntegrationConnection) => AdapterIntegrationConnection = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationAdapter: adapter → protocol', () => {
    const check: (_: AdapterIntegrationAdapter) => ProtocolIntegrationAdapter = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationAdapter: protocol → adapter', () => {
    const check: (_: ProtocolIntegrationAdapter) => AdapterIntegrationAdapter = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE ADAPTER ALIGNMENT (factory return types)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database adapter ↔ protocol interface alignment', () => {
  it('createUserDatabase return type is assignable to protocol UserDatabase', () => {
    type UserDbReturn = ReturnType<typeof createUserDatabase>;
    const check: (_: UserDbReturn) => ProtocolUserDatabase = (v) => v;
    expect(check).toBeDefined();
  });

  it('createSystemDatabase return type is assignable to protocol SystemDatabase', () => {
    type SystemDbReturn = ReturnType<typeof createSystemDatabase>;
    const check: (_: SystemDbReturn) => ProtocolSystemDatabase = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUESTIONER ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Questioner adapter ↔ protocol interface alignment', () => {
  it('PersistableQuestion: adapter → protocol', () => {
    const check: (_: AdapterPersistableQuestion) => ProtocolPersistableQuestion = (v) => v;
    expect(check).toBeDefined();
  });

  it('PersistableQuestion: protocol → adapter', () => {
    const check: (_: ProtocolPersistableQuestion) => AdapterPersistableQuestion = (v) => v;
    expect(check).toBeDefined();
  });

  it('PersistedQuestion: adapter → protocol', () => {
    const check: (_: AdapterPersistedQuestion) => ProtocolPersistedQuestion = (v) => v;
    expect(check).toBeDefined();
  });

  it('PersistedQuestion: protocol → adapter', () => {
    const check: (_: ProtocolPersistedQuestion) => AdapterPersistedQuestion = (v) => v;
    expect(check).toBeDefined();
  });

  it('QuestionFilters: adapter → protocol', () => {
    const check: (_: AdapterQuestionFilters) => ProtocolQuestionFilters = (v) => v;
    expect(check).toBeDefined();
  });

  it('QuestionFilters: protocol → adapter', () => {
    const check: (_: ProtocolQuestionFilters) => AdapterQuestionFilters = (v) => v;
    expect(check).toBeDefined();
  });

  it('QuestionerAdapter is assignable to protocol QuestionerDatabase', () => {
    const check: (_: QuestionerAdapter) => ProtocolQuestionerDatabase = (v) => v;
    expect(check).toBeDefined();
  });
});
