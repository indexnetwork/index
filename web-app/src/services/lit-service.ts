import { SiweMessage } from "@didtools/cacao";
import { ethers } from "ethers";

class LitService {
  async getRandomAuthSig() {
    const wallet = ethers.Wallet.createRandom();

    const domain = "index.network";
    const origin = "https://index.network";
    const statement = "API Token for indexes.";
    const siweMessage = new SiweMessage({
      domain,
      address: wallet.address,
      statement,
      uri: origin,
      version: "1",
      chainId: "1",
    });
    const messageToSign = siweMessage.toMessage();

    const signature = await wallet.signMessage(messageToSign);

    const authSig = {
      sig: signature,
      derivedVia: "web3.eth.personal.sign",
      signedMessage: messageToSign,
      address: wallet.address,
    };

    return authSig;
  }

  checkAndSignAuthMessage() {
    JSON.parse(localStorage.getItem("authSig")!);
  }
}
const litService = new LitService();
export default litService;
