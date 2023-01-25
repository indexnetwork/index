/**
 * Model indexes
 *
 */
export type IndexesNew = {
  title: string | null
  version: string
  collabAction: string | null
};

export type Indexes = {
  streamId: string
  title: string | null
  publicRights: EnumIndexVisibility | null
  privateLinkRights: EnumIndexVisibility | null
  privateLinkCode: string | null
  clonedFrom: string | null
  createdAt: string;
  updatedAt: string;
	address: string;
	links: Links[];
};

/**
 * Model IndexUsers
 *
 */
export type IndexUsers = {
  id: number
  streamId: string
  address: string
  permission: EnumIndexUsersRole | null
  createdAt: string;
  updatedAt: string;
};

/**
 * Model invitations
 *
 */
export type Invitations = {
  id: number
  streamId: string
	family: string
  invitingAddress: string
  invitedAddress: string
  permission: EnumInviteRight | null
  url: string
  status: EnumInviteStatus | null
  createdAt: string;
  updatedAt: string;
};

/**
 * Model links
 *
 */
export type LinksNew = {
  indexID?: string
  indexer_did?: string
  url?: string
  title?: string
  tags?: string[]
  content?: string
  version?: string
};
export type Links = {
  id?: string;
  content?: string
  title?: string
  url?: string
  description?: string
  language?: string
  favicon?: string
  createdAt?: string;
  updatedAt?: string;
  images?: string[]
  favorite?: boolean;
  tags?: string[]
};

/**
 * Model users
 *
 */
export type Users = {
  address: string
  name: string | null
  username: string | null
  picture: string | null
  location: string | null
  visibility: boolean
  bio: string | null
  urlWeb: string | null
  apiKey: string | null
  zapierToken: string | null
  createdAt: Date
  updatedAt: Date
};

export interface LinkContentResult {
  id?: string;
  address: string;
  streamId: string;
  links: Links[];
}

export interface SyncCompleteResult {
  deletedCount: number,
}
/**
 * Enums
 */

export type EnumIndexVisibility = {
	off: "off",
	edit: "edit",
	view: "view",
};

export type EnumIndexUsersRole = {
  owner: "owner",
  edit: "edit",
  view: "view"
};

export type EnumInviteRight = {
  view: "view",
  edit: "edit"
};

export type EnumInviteStatus = {
	pending: "pending",
	approved: "approved",
	rejected: "rejected",
};
