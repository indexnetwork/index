export interface ApiServiceConfig {
  baseUrl: string;
  id: string;
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
  ownerDID: {
    id: string;
    name: string;
    bio: string;
    avatar: string;
    createdAt: string;
    updatedAt: string;
  };
}