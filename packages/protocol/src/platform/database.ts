/**
 * The database port: a stable host contract, not a database implementation.
 *
 * The declarations moved into sibling modules — entities, the four query
 * groups that compose `Database`, the access-scoped views, negotiation
 * persistence, and the capability-narrowed aliases. Importers keep using this
 * path; nothing about the types changed.
 */

import type { DatabaseIdentityQueries } from "./database/identity-queries.js";
import type { DatabaseMemberQueries } from "./database/member-queries.js";
import type { DatabaseNetworkQueries } from "./database/network-queries.js";
import type { DatabaseOpportunityQueries } from "./database/opportunity-queries.js";

/** The complete persistence contract a host may implement. */
export interface Database extends DatabaseIdentityQueries, DatabaseNetworkQueries, DatabaseOpportunityQueries, DatabaseMemberQueries {}

export type * from './database/entities.js';
export type * from './database/identity-queries.js';
export type * from './database/network-queries.js';
export type * from './database/opportunity-queries.js';
export type * from './database/member-queries.js';
export type * from './database/port.js';
export type * from './database/negotiation.js';
export type * from './database/capabilities.js';
