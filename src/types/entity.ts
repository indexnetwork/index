/**
 * Model indexes
 *
 */

export type Indexes = {
  id: string
  title: string | null
  collab_action: string
  controller_did: { // This is PKP DID
    id: string
  };
  owner_did: { // This is PKP Owner DID
    id: string
  };
  created_at: string;
  updated_at: string;
  links: Links[];
  is_in_my_indexes?: boolean;
  is_starred?: boolean;
};

export type IndexLink = {
  id?: string
  index_id: string;
  link_id: string;
  indexer_did: string // This is Personal DID
  controller_did?: { // This is PKP DID
    id: string
  };
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

/**
 * Model UserIndex
 *
 */
export type UserIndex = {
  id: number
  index_id: string
  type: string
  created_at: string;
  deleted_at?: string;
};

/**
 * Model links
 *
 */
export type Links = {
  id?: string;
  index_id?: string;
  indexer_did?: string;
  content?: string
  title?: string
  url?: string
  description?: string
  language?: string
  favicon?: string
  created_at?: string;
  updated_at?: string;
  images?: string[]
  favorite?: boolean;
  tags?: string[]
  highlight?: {
    title?: string
    content?: string
    tags?: string
    url?: string
  }
};

/**
 * Model users
 *
 */
export interface Users {
  name?: string;
  description?: string;
  pfp?: string;
  created_at?: Date;
  updated_at?: Date;
  available?: boolean; // TODO debug
}

export interface LinkContentResult {
  id?: string;
  address: string;
  links: Links[];
}

export interface SyncCompleteResult {
  deletedCount: number,
}
/**
 * Enums
 */
