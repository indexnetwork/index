import { Cacao, SiweMessage } from "@didtools/cacao";
import { randomBytes } from "@stablelib/random";
import { DID } from "dids";
import { DIDSession, createDIDCacao } from "did-session";
import { ethers } from "ethers";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";

class LitService {
  async getRandomDIDSession() {
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

    siweMessage.signature = await wallet.signMessage(messageToSign);

    const keySeed = randomBytes(32);
    const didProvider = new Ed25519Provider(keySeed);
    // @ts-ignore
    const didKey = new DID({ provider: didProvider, resolver: getResolver() });
    await didKey.authenticate();
    const cacao = Cacao.fromSiweMessage(siweMessage);

    const did = await createDIDCacao(didKey, cacao);
    const didSession = new DIDSession({ cacao, keySeed, did });

    return {
      address: wallet.address,
      session: didSession.serialize(),
    }
    /*
    const authSig = {
      sig: signature,
      derivedVia: "web3.eth.personal.sign",
      signedMessage: messageToSign,
      address: wallet.address,
    };
    return authSig;
    */
  }

  checkAndSignAuthMessage() {
    JSON.parse(localStorage.getItem("authSig")!);
  }
}
const litService = new LitService();
export default litService;
