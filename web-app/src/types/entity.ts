/**
 * Model indexes
 *
 */

import { CID } from "multiformats";

export type Indexes = {
  id: string;
  title: string;
  signerFunction: string;
  signerPublicKey: string;
  did: {
    owned: boolean;
    starred: boolean;
  };
  roles: {
    owner: boolean;
    creator: boolean;
  };
  controllerDID: Users;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  links: IndexLink[];
};

export type Conversation = {
  id: string;
  controllerDID: Users;
  messages: any[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
};

export type WebNode = {
  id: string;
  title: string;
  favicon?: string;
  url: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
};

export type TeamNode = {
  id: string;
  name: string;
  logo?: string;
  website: string;
  shortDescription?: string;
};

export type IndexIndexNode = {
  id: string;
  title: string;
  updatedAt: string;
};

export type DefaultIndexNode = {
  id: string;
  title: string;
  updatedAt: string;
};

export type CastIndexNode = {
  id: string;
  text: string;
  thread_hash: string;
  timestamp: string;
  author: {
    username: string;
  };
};

export type IndexWebPageItem = {
  type: string;
  node: WebNode;
};

export type IndexTeamNodeItem = {
  type: string;
  node: TeamNode;
};

export type IndexIndexNodeItem = {
  type: string;
  node: IndexIndexNode;
};

export type DefaultIndexNodeItem = {
  type: string;
  node: DefaultIndexNode;
};

export type CastIndexNodeItem = {
  type: string;
  node: CastIndexNode;
};

export type IndexItem =
  | IndexWebPageItem
  | IndexTeamNodeItem
  | IndexIndexNodeItem
  | DefaultIndexNodeItem
  | CastIndexNodeItem;

export type IndexLink = {
  id?: string;
  indexId?: string;
  linkId?: string;
  content?: string;
  url?: string;
  indexerDID?:
    | {
        // This is PKP DID
        id: string;
      }
    | string;
  controllerDID?: {
    // This is PKP DID
    id: string;
  };
  link?: Link;
  index?: Indexes;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  highlight?: {
    title?: string;
    "link.content"?: string;
    "link.tags"?: string;
    "link.url"?: string;
    "link.title"?: string;
  };
};

/**
 * Model UserIndex
 *
 */
export type UserIndex = {
  id: string;
  indexId: string;
  controllerDID?: {
    // This is PKP DID
    id: string;
  };
  type: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

/**
 * Model links
 *
 */
export type Link = {
  id: string;
  indexId?: string;
  indexerDID?: string;
  content?: string;
  title?: string;
  url?: string;
  description?: string;
  language?: string;
  favicon?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  images?: string[];
  favorite?: boolean;
  tags?: string[];
};

/**
 * Model users
 *
 */
export interface Users {
  id: string;
  name?: string;
  bio?: string;
  avatar?: CID;
  createdAt?: string;
  updatedAt?: string;
}

export interface LinkContentResult {
  id?: string;
  address: string;
  links: Link[];
}

export interface SyncCompleteResult {
  deletedCount: number;
}
/**
 * Enums
 */

export interface AccessControlCondition {
  chain: string;
  method: string;
  standardContractType: string;
  contractAddress: string;
  conditionType: string;
  parameters: string[];
  returnValueTest: object;
}

export interface IndexListState {
  skip: number;
  totalCount: number;
  hasMore: boolean;
  indexes?: Indexes[];
}
export interface MultipleIndexListState {
  all: IndexListState;
  owner: IndexListState;
  starred: IndexListState;
}
