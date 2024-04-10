import mailchimp from "@mailchimp/mailchimp_marketing";
import Web3 from "web3";
import RedisClient from '../clients/redis.js';
const redis = RedisClient.getInstance();

mailchimp.setConfig({
    apiKey: process.env.MAILCHIMP_API_KEY,
    server: "us8"
});

export const subscribe = async (req, res, next) => {
    const { email } = req.body;
    try {
        const response = await mailchimp.lists.addListMember(process.env.MAILCHIMP_LIST_ID, {
            email_address: email,
            status: "subscribed"
        });
        res.json({ success: true, message: "Subscription successful", data: response });
    } catch (error) {
        console.error('Mailchimp subscription error:', error);
        if (error.response && error.response.body.title === "Member Exists") {
            res.status(400).json({ success: false, message: "This email is already subscribed." });
        } else if (error.response && error.response.body.title === "Invalid Resource") {
            res.status(400).json({ success: false, message: "Invalid email address." });
        } else {
            const status = error.response ? error.response.status : 500;
            const message = error.response ? error.response.body.detail : "An error occurred while subscribing.";
            res.status(status).json({ success: false, message });
        }
    }
}

export const faucet = async (req, res, next) => {
    const { address } = req.query;

    const isMember = await redis.sIsMember(`faucet`, address)
    if(isMember){
        return res.status(200).json({ success: false, message: "Already sent!" });
    }
    // Initialize Web3 with the provided RPC URL
    const web3 = new Web3('https://chain-rpc.litprotocol.com/http');
    // Check if connected to blockchain
    try {
        const isListening = await web3.eth.net.isListening();
        if (isListening) {
            console.log('Connected to LitProtocol');
        }
    } catch (error) {
        return res.status(400).json({ success: false, message: "Faucet failed" });
    }

    // Your account address and private key
    const accountAddress = process.env.FAUCET_ADDRESS;
    const privateKey = process.env.FAUCET_PRIVATE_KEY

    // Amount to send in LIT
    const amount = web3.utils.toWei('0.0001', 'ether'); // 0.1 LIT, adjusted for 18 decimals

    // Transaction details
    const transaction = {
        chainId: 175177,  // LitProtocol Chain ID
        gas: 21000,
        to: address,
        value: amount,
        data: ''
    };

    // Estimate gas price
    const estimatedGasPrice = await web3.eth.getGasPrice();
    transaction.gasPrice = estimatedGasPrice;
    console.log(`Estimated Gas Price: ${web3.utils.fromWei(estimatedGasPrice, 'gwei')} gwei`);

    // Get the account nonce
    const nonce = await web3.eth.getTransactionCount(accountAddress);
    transaction.nonce = nonce;

    // Sign the transaction
    const signedTx = await web3.eth.accounts.signTransaction(transaction, privateKey);

    // Send the transaction
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    console.log(`Transaction Hash: ${receipt.transactionHash}`);
    // Serialize the receipt, converting BigInts to strings
    const serializedReceipt = JSON.stringify(receipt, (key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
    console.log(`Transaction Receipt: ${serializedReceipt}`);

    await redis.sAdd(`faucet`, address)
    res.json({ success: true, message: "Faucet successful"});
}
