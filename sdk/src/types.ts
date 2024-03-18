import { CID } from "multiformats/cid";

export interface IIndex {
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
  ownerDID: IUser;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  links: ILink[];
}

export interface IUser {
  id: string;
  name?: string;
  bio?: string;
  avatar?: CID;
  createdAt?: string;
  updatedAt?: string;
}

export interface ILink {
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
}

export interface ILitActionConditions {
  chain: string;
  method: string;
  standardContractType: string;
  contractAddress: string;
  conditionType: string;
  parameters: string[];
  returnValueTest: object;
}

export interface ICreatorAction {
  cid: string;
}

export interface IGetItemQueryParams {
  limit?: number;
  cursor?: string;
  query?: string;
}

export interface IUserProfileUpdateParams {
  name?: string;
  bio?: string;
  avatar?: string;
}
