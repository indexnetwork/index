import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

import { chains } from "../types/chains.js";

import { ethers } from "ethers";

import Moralis from "moralis";

const ethProvider = new ethers.providers.InfuraProvider("mainnet", {
  projectId: `75984fd56f8c4508a6f8e0cdb21c3edb`,
  projectSecret: `uQJdKF6wMPvmF+213HwEHS9mU7ODPD5zm1yB/r/YkJK9JQNwSWZAGg`,
});

import RedisClient from "../clients/redis.js";
const redis = RedisClient.getInstance();


export const getConfig = async (req, res) => {
  return res.json({
    "indexes": [
      {
        "id": "farcaster",
        "name": "Farcaster",
        "icon": "https://ipfs.index.network/files/bafkreier4wpucogz5ges5vv52biixsvbtsigf7wn5ofl6tyxfp72my6pxi",
        "status": "available"
      },
      {
        "id": "luma",
        "name": "Luma",
        "icon": "https://ipfs.index.network/files/bafkreiaxldbxxawcdf7xx4yjbckbf7g55k5r2ytvi6ovfs3bczlpyweql4",
        "status": "available"
      },
      {
        "id": "paragraph",
        "name": "Paragraph.xyz",
        "icon": "https://ipfs.index.network/files/bafkreigd5ptivtvh2d3jpkjpxfmrnwq3466j7gaxquv5avtfvuakr7mv6i",
        "status": "coming_soon"
      }
    ],
    "agents": [
      {
        "id": "index",
        "name": "Index",
        "icon": "https://ipfs.index.network/files/bafkreiae3iniramo3pcndjyxhp7f6j2p3jmxvk3ucfxwbzo64i5urhtwqe",
        "description": "Your primary assistant that answers questions"
      },
      {
        "id": "context_broker",
        "name": "Context Broker",
        "icon": "https://ipfs.index.network/files/bafkreibaeqrgneaiycjxepk7y27win3wg5oc54wxgxq52zozmbhwl6a2rm",
        "description": "Discovers relevant conversations while protecting everyone's privacy"
      },
      {
        "id": "listener",
        "name": "Listener",
        "icon": "https://ipfs.index.network/files/bafkreicv4efbogifz5vz3semshdkhs2uq3js3ssbep6qfqkjwzcavkg7ya",
        "description": "Tracks your curiosities and sends updates when it's relevant."
      }
    ]
  })  

}

export const getAvatar = async (ensName) => {
  try {
    const resolver = await ethProvider.getResolver(ensName);
    const avatar = await resolver?.getText("avatar");
    if (!avatar || avatar.length === 0) return null;
    if (avatar.startsWith(`eip155`)) {
      return null
    }
    return avatar;
  } catch (error) {
    console.log(`get Avatar error`, error);
    return null;
  }
};

export const getENSProfileByWallet = async (wallet) => {
  const cache = await redis.hGet(`ens`, wallet);
  if (cache) {
    return JSON.parse(cache);
  }
  const walletData = await ethProvider.lookupAddress(wallet);
  if (walletData) {
    let profile = {
      ensName: walletData,
    };
    const avatar = await getAvatar(walletData);
    if (avatar) {
      profile.image = avatar;
    }
    await redis.hSet(`ens`, wallet, JSON.stringify(profile));
    return profile;
  }
};
export const getWalletByENS = async (ens) => {
  const walletData = await ethProvider.resolveName(ens);
  return walletData;
};
export const getCollectionMetadataApi = async (chainName, tokenAddress) => {
  const chain = chains[chainName];

  try {
    const hexChain = "0x" + chain.chainId.toString(16);
    const response = await Moralis.EvmApi.nft.getNFTContractMetadata({
      chain: hexChain,
      address: tokenAddress,
    });

    if (response && response.raw && response.raw.token_address) {
      return {
        symbol: response.raw.symbol,
        name: response.raw.name,
        token: response.raw.token_address,
        tokenType: response.raw.contract_type,
      };
    }
  } catch (e) {
    console.error(e);
  }
};

export const getNftMetadataApi = async (
  chainName,
  tokenAddress,
  tokenId,
  resyncMetadata = false,
) => {
  try {
    const chain = chains[chainName];
    const hexChain = "0x" + chain.chainId.toString(16);

    const response = await Moralis.EvmApi.nft.getNFTMetadata({
      chain: hexChain,
      address: tokenAddress,
      normalizeMetadata: true,
      tokenId: tokenId,
    });

    return {
      metadata: {
        name: response.raw.name,
        image: response.raw.normalized_metadata.image,
      },
    };
  } catch (error) {
    console.log(error);
    //throw new Error('Failed to fetch NFT metadata');
  }
};

export const getCollectionMetadataHandler = async (req, res) => {
  const { chainName, tokenAddress } = req.params;
  try {
    const metadata = await getCollectionMetadataApi(chainName, tokenAddress);
    if (metadata) {
      res.json(metadata);
    } else {
      res.status(404).json({ error: "Contract not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getNftMetadataHandler = async (req, res) => {
  const { chainName, tokenAddress, tokenId } = req.params;
  const resyncMetadata = req.query.resyncMetadata || false;
  try {
    const contract = await getCollectionMetadataApi(chainName, tokenAddress);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }
    const tokenData = await getNftMetadataApi(
      chainName,
      tokenAddress,
      tokenId,
      resyncMetadata,
    );

    if (tokenData) {
      contract.token = tokenData.token_id;
    }
    res.json(contract);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getWalletByENSHandler = async (req, res) => {
  const { ensName } = req.params;
  try {
    const metadata = await getWalletByENS(ensName);
    res.json({
      walletAddress: metadata,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
