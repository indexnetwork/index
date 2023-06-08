import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}
import axios from 'axios';
const BASE_URL = 'https://nft.api.infura.io';
import { chains } from '../config/chains.js';

const getAuthorizationHeader = () => {
    return Buffer.from(`${process.env.INFURA_API_KEY}:${process.env.INFURA_API_KEY_SECRET}`)
        .toString('base64')
}

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
    console.log(chain, tokenAddress, tokenId);
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
        const metadata = await getNftMetadataApi(chainName, tokenAddress, tokenId, resyncMetadata);
        res.json(metadata);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
