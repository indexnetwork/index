const Moralis = require("moralis");
const {getPkpPublicKey, encodeDIDWithLit, walletToDID} = require("../utils/lit");

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

module.exports.indexPKP = async (req, res, next) => {

    const { headers, body } = req;

    Moralis.Streams.verifySignature({
        body,
        signature: headers["x-signature"],
    }); // throws error if not valid

    const { chainId, nftTransfers } = body;

    if(nftTransfers.length === 0){
        return res.status(200).end();
    }

    const event = nftTransfers[0]

    let pkpPubKey = await getPkpPublicKey(event.tokenId)
    let pkpDID = encodeDIDWithLit(pkpPubKey);
    let ownerDID = walletToDID(chainId, event.to);
    await redis.hSet(`pkp:owner`, pkpDID, ownerDID)

    return res.status(201).end();
    /*
    let indexId = await getIndexByPKP(pkpDID);

    if(indexId){

        await this.createUserIndex({
            "controller_did": walletToDID(chainId, event.to),
            "type":"my_indexes",
            "index_id": indexId,
            "created_at": new Date().toISOString()
        })

        if(event.from !== "0x0000000000000000000000000000000000000000"){
            await this.updateUserIndex({
                "controller_did": walletToDID(chainId, event.from),
                "type":"my_indexes",
                "index_id": indexId,
                "created_at": new Date().toISOString(),
                "deleted_at": new Date().toISOString()
            })
        }
    }

     */

}
