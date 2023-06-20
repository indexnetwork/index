import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}
import axios from 'axios';
const BASE_URL = 'https://nft.api.infura.io';
import { chains } from '../config/chains.js';

import { ethers } from 'ethers'

const ethProvider = new ethers.InfuraProvider("mainnet")

const getAuthorizationHeader = () => {
    return Buffer.from(`${process.env.INFURA_API_KEY}:${process.env.INFURA_API_KEY_SECRET}`)
        .toString('base64')
}

export const getAvatar = async (ensName) => {
    try {
        const resolver = await ethProvider.getResolver(ensName);
        const avatar = await resolver?.getText("avatar");
        if (!avatar || avatar.length === 0) return null;
        return avatar;
    } catch (error) {
        console.log(`get Avatar error`, error);
        return null;
    }
}

export const getProfile = async (wallet) => {
    const walletData = await ethProvider.lookupAddress(wallet);
    if(walletData){
        let profile = {
            ensName: walletData,
        };
        const avatar = await getAvatar(walletData)
        if(avatar){
            profile.image = avatar;
        }
        return profile;
    }
};

export const getCollectionMetadataApi = async (chainName, tokenAddress) => {
    const chain = chains[chainName];
    try {
        const response = await axios.get(`${BASE_URL}/networks/${chain.chainId}/nfts/${tokenAddress}`, {
            headers: {
                'Authorization': `Basic ${getAuthorizationHeader()}`,
            },
        });
        return response.data;
    } catch (error) {
        //throw new Error('Failed to fetch collection metadata');
    }
};

export const getNftMetadataApi = async (chainName, tokenAddress, tokenId, resyncMetadata = false) => {
    const chain = chains[chainName];
    try {
        const response = await axios.get(`${BASE_URL}/networks/${chain.chainId}/nfts/${tokenAddress}/tokens/${tokenId}?resyncMetadata=${resyncMetadata}`, {
            headers: {
                'Authorization': `Basic ${getAuthorizationHeader()}`,
            },
        });
        return response.data;
    } catch (error) {
        //throw new Error('Failed to fetch NFT metadata');
    }
};


export const getCollectionMetadataHandler = async (req, res) => {
    const { chainName, tokenAddress } = req.params;
    try {
        const metadata = await getCollectionMetadataApi(chainName, tokenAddress);
        res.json(metadata);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getNftMetadataHandler = async (req, res) => {
    const { chainName, tokenAddress, tokenId } = req.params;
    const resyncMetadata = req.query.resyncMetadata || false;
    try {
        const contract = await getCollectionMetadataApi(chainName, tokenAddress);
        if(!contract){
            return res.status(404).json({ error: 'Contract not found' });
        }
        const tokenData = await getNftMetadataApi(chainName, tokenAddress, tokenId, resyncMetadata);
        if(tokenData){
            contract.token = tokenData.metadata;
        }
        res.json(contract);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
