import { Cacao, SiweMessage } from "@didtools/cacao";
import { randomBytes, randomString } from "@stablelib/random";
import { DID } from "dids";
import { DIDSession, createDIDCacao } from "did-session";
import { ethers } from "ethers";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";

class DIDService {
  async getRandomDIDSession(indexId: string) {
    const wallet = ethers.Wallet.createRandom();

    const keySeed = randomBytes(32);
    const didProvider = new Ed25519Provider(keySeed);
    // @ts-ignore
    const didKey = new DID({ provider: didProvider, resolver: getResolver() });
    await didKey.authenticate();

    const now = new Date(Date.now());
    const thirtyDaysLater = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

    const domain = "index.network";

    const siweMessage = new SiweMessage({
      domain,
      address: wallet.address,
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey.id,
      version: "1",
      chainId: "1",
      nonce: randomString(10),
      issuedAt: now.toISOString(),
      expirationTime: thirtyDaysLater.toISOString(),
      resources: ["ceramic://*"],
    });
    const messageToSign = siweMessage.toMessage();

    siweMessage.signature = await wallet.signMessage(messageToSign);

    const cacao = Cacao.fromSiweMessage(siweMessage);

    const did = await createDIDCacao(didKey, cacao);
    const didSession = new DIDSession({ cacao, keySeed, did });

    return {
      address: wallet.address,
      session: didSession.serialize(),
      indexId,
    };
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
const didService = new DIDService();
export default didService;
