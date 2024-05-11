export const appConfig = {
  baseUrl: "https://dev.index.network/",
  apiUrl: "https://dev.index.network/api", // TODO: handle better
  ipfsProxy: "https://ipfs.io/ipfs",
  defaultCID: "QmTnEgo5JY44Kk4rR9F7RoUb7fPw4xmbiW6Eqzs8aTg1jp", // Empty.
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
