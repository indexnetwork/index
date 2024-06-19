import { DIDSession } from "did-session";

export interface ApiServiceConfig {
  baseUrl: string;
  session?: DIDSession | undefined;
}

export interface FetchIndexResponse {
  id: string;
  title: string;
  collabAction: string;
  pkpPublicKey: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  controllerDID: {
    id: string;
  };
  controllerDID: {
    id: string;
    name: string;
    bio: string;
    avatar: string;
    createdAt: string;
    updatedAt: string;
  };
}
