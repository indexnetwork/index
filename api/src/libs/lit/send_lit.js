import { JsonRpcProvider, Wallet } from "ethers";
import Web3 from "web3";

export const sendLit = async (to, amount) => {


  const web3 = new Web3(process.env.LIT_PROTOCOL_RPC_PROVIDER);
  // Check if connected to blockchain
  try {
      const isListening = await web3.eth.net.isListening();
      if (isListening) {
          console.log('Connected to LitProtocol');
      }
  } catch (error) {
      return res.status(400).json({ success: false, message: "Faucet failed" });
  }
  const wallet = new Wallet(
    process.env.INDEXER_WALLET_PRIVATE_KEY,
    new JsonRpcProvider(process.env.LIT_PROTOCOL_RPC_PROVIDER),
  );
  // Your account address and private key

  // Amount to send in LIT
  const amountVal = web3.utils.toWei(amount, 'ether'); // 0.1 LIT, adjusted for 18 decimals

  // Transaction details
  const transaction = {
      chainId: 175177,  // LitProtocol Chain ID
      gas: 21000,
      to: to,
      value: amountVal,
      data: ''
  };

  // Estimate gas price
  const estimatedGasPrice = await web3.eth.getGasPrice();
  transaction.gasPrice = estimatedGasPrice;
  console.log(`Estimated Gas Price: ${web3.utils.fromWei(estimatedGasPrice, 'gwei')} gwei`);

  // Get the account nonce
  const nonce = await web3.eth.getTransactionCount(wallet.address);
  transaction.nonce = nonce;

  // Sign the transaction
  const signedTx = await web3.eth.accounts.signTransaction(transaction, wallet.privateKey);

  // Send the transaction
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  console.log(`Transaction Hash: ${receipt.transactionHash}`);
  // Serialize the receipt, converting BigInts to strings
  const serializedReceipt = JSON.stringify(receipt, (key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
  console.log(`Transaction Receipt: ${serializedReceipt}`);

  return serializedReceipt;
}
