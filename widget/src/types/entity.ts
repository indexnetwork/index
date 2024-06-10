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

// {
//   "type": "WebPage",
//   "node": {
//       "id": "kjzl6kcym7w8y7fjc89gmnkne7qpdz5ws5ryfji3i8dndjh2wxuii7z1anybovo",
//       "title": "Post medium publishing",
//       "favicon": null,
//       "url": "https://www.paulgraham.com/publishing.html",
//       "content": null,
//       "createdAt": "2024-01-17T23:58:51.204Z",
//       "updatedAt": "2024-01-17T23:58:51.204Z",
//       "deletedAt": null
//   }
// },

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

export type IndexWebPageItem = {
  type: string;
  node: WebNode;
};

export type IndexItem = IndexWebPageItem;

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
