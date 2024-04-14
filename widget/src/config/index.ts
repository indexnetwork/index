export interface AppConfig {
  name: string;
  website: string;
  version: string;
  description: string;
  apiUrl: string;
  ipfsGateway: string;
  ipfsProxy: string;
  ipfsInfura: string;
  litNetwork: "cayenne" | "custom" | "localhost" | "manzano" | "habanero";
  testNetwork: {
    chainId: string;
    chainName: string;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
}

export const appConfig: AppConfig = {
  name: "Index Chat",
  website: "https://index.network",
  version: "1",
  description: "Chat with your indexes, easy as pie.",
  apiUrl: "https://index.network",
  ipfsGateway: "https://indexas.infura-ipfs.io/ipfs",
  ipfsProxy: "https://ipfs.io/ipfs",
  ipfsInfura: "http://localhost:3001/avatar",
  litNetwork: "habanero",
  testNetwork: {
    chainId: "0x2ac49",
    chainName: "Chronicle - Lit Protocol Testnet",
    nativeCurrency: {
      name: "LIT",
      symbol: "LIT",
      decimals: 18,
    },
    rpcUrls: ["https://chain-rpc.litprotocol.com/http"],
    blockExplorerUrls: ["https://chain.litprotocol.com"],
  },
};
