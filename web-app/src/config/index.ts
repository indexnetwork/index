export const appConfig = {
  baseUrl: "https://index.network/",
  apiUrl: "https://dev.index.network/api", // TODO: handle better
  ipfsProxy: "https://ipfs.io/ipfs",
  ipfsInfura: "http://localhost:3001/avatar",
  defaultCID: "Qma1fQKSYtcGZ2vJ7CHEY9B4gd967V3cX5Bfmfwp19FjDP", // Empty.
  litNetwork: "habanero" as
    | "cayenne"
    | "custom"
    | "localhost"
    | "manzano"
    | "habanero",
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
  chains: {
    ethereum: {
      value: "ethereum",
      label: "Ethereum",
      abbreviation: "eth",
      logo: "ethLogo.svg",
      chainId: 1,
    },
    polygon: {
      value: "polygon",
      label: "Polygon",
      abbreviation: "matic",
      logo: "polygonLogo.svg",
      chainId: 137,
    },
    arbitrum: {
      value: "arbitrum",
      label: "Arbitrum",
      abbreviation: "arbitrum",
      logo: "arbitrumLogo.svg",
      chainId: 42161,
    },
    avalanche: {
      value: "avalanche",
      label: "Avalanche C-Chain",
      abbreviation: "avax",
      logo: "avalancheLogo.svg",
      chainId: 43114,
    },
    optimism: {
      value: "optimism",
      label: "Optimism",
      abbreviation: "op",
      logo: "optimismLogo.jpeg",
      chainId: 10,
    },
    celo: {
      value: "celo",
      label: "Celo",
      abbreviation: "celo",
      logo: "celoLogo.svg",
      chainId: 42220,
    },
    fuji: {
      value: "fuji",
      label: "Avalanche FUJI Testnet",
      abbreviation: "avalan",
      logo: "avalancheLogo.svg",
      chainId: 43113,
    },
    mumbai: {
      value: "mumbai",
      label: "Mumbai",
      abbreviation: "mumbai",
      logo: "polygonLogo.svg",
      chainId: 80001,
    },
    goerli: {
      value: "goerli",
      label: "Goerli",
      abbreviation: "goerli",
      logo: "goerliLogo.png",
      chainId: 5,
    },
    aurora: {
      value: "aurora",
      label: "Aurora",
      abbreviation: "aoa",
      logo: "auroraLogo.svg",
      chainId: 1313161554,
    },
  },
};
