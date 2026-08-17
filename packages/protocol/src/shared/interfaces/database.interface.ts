/**
 * The database port, re-exported as one surface.
 *
 * The declarations moved into sibling modules — entities, the four query
 * groups that compose `Database`, the access-scoped views, negotiation
 * persistence, and the capability-narrowed aliases. Importers keep using this
 * path; nothing about the types changed.
 */

export type * from './database.entities.js';
export type * from './database.identity-queries.js';
export type * from './database.network-queries.js';
export type * from './database.opportunity-queries.js';
export type * from './database.member-queries.js';
export type * from './database.port.js';
export type * from './database.negotiation.js';
export type * from './database.capabilities.js';
