export interface AppConfig {
  name: string;
  website: string;
  version: string;
  description: string;
  apiUrl: string;
  ipfsGateway: string;
};

export const appConfig: AppConfig = {
  name: 'Web SDK',
  website: 'https://index.network',
  version: '0.1',
  description: 'Chat with your indexes',
  apiUrl: 'https://index.network',
  ipfsGateway: 'https://indexas.infura-ipfs.io/ipfs',
};