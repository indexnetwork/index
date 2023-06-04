import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}
import axios from 'axios';
const BASE_URL = 'https://nft.api.infura.io';

const getAuthorizationHeader = () => {
    return Buffer.from(`${process.env.INFURA_API_KEY}:${process.env.INFURA_API_KEY_SECRET}`)
        .toString('base64')
}

export const getCollectionMetadata = async (req, res) => {
    const { chainId, tokenAddress } = req.params;
    try {
        const response = await axios.get(`${BASE_URL}/networks/${chainId}/nfts/${tokenAddress}`,{
            headers: {
                'Authorization': `Basic ${getAuthorizationHeader()}`
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error});
    }
}

export const getNftMetadata = async (req, res) => {
    const { chainId, tokenAddress, tokenId } = req.params;
    const resyncMetadata = req.query.resyncMetadata || false;
    try {
        const response = await axios.get(`${BASE_URL}/networks/${chainId}/nfts/${tokenAddress}/tokens/${tokenId}?resyncMetadata=${resyncMetadata}`,{
            headers: {
                'Authorization': `Basic ${getAuthorizationHeader()}`
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
}
