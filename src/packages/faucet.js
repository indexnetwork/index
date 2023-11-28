import RedisClient from '../clients/redis.js';
import Web3 from 'web3';

const redis = RedisClient.getInstance();

export const sendLit = async (address) => {
    return true;
    const isMember = await redis.sIsMember(`faucet`, address)
    if(isMember){
        return true;
    }
    // Initialize Web3 with the provided RPC URL
    const web3 = new Web3('https://lit-protocol.calderachain.xyz/http');
    // Check if connected to blockchain
    try {
        const isListening = await web3.eth.net.isListening();
        if (isListening) {
            console.log('Connected to LitProtocol');
        }
    } catch (error) {
        console.log('Not connected');
        return;
    }

    // Your account address and private key
    const accountAddress = process.env.FAUCET_ADDRESS;
    const privateKey = process.env.FAUCET_PRIVATE_KEY

    // Amount to send in LIT
    const amount = web3.utils.toWei('0.01', 'ether'); // 0.1 LIT, adjusted for 18 decimals

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
    return true;
};
