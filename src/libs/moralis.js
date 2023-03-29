const Moralis = require("moralis").default;

const {getPkpPublicKey, encodeDIDWithLit, walletToDID} = require("../utils/lit");

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();


module.exports.indexPKP = async (req, res, next) => {

    const { headers, body } = req;

    const { chainId, nftTransfers, confirmed } = body;

    /*
    try {
        Moralis.Streams.verifySignature({
            body,
            signature: headers["x-signature"],
        }); // throws error if not valid
    } catch (error) {
        if(confirmed){
            return res.status(200).end();
        }else{
            console.log("Invalid request signature");
            return res.status(400).end();
        }
    }
    */
    if(nftTransfers.length === 0){
        return res.status(200).end();
    }

    const event = nftTransfers[0]

    let pkpPubKey = await getPkpPublicKey(event.tokenId)
    let pkpDID = encodeDIDWithLit(pkpPubKey);
    let ownerDID = walletToDID(chainId, event.to);
    await redis.hSet(`pkp:owner`, pkpDID.toLowerCase(), ownerDID.toLowerCase())

    return res.status(201).end();

}
