import { Cacao, SiweMessage } from "@didtools/cacao";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { normalizeAccountId } from "@ceramicnetwork/common";
import { getAccountId } from "@didtools/pkh-ethereum";
import { getAddress } from "@ethersproject/address";

class DIDService {
  async getNewDIDSession() {
    const ethProvider = window.ethereum;

    // request ethereum accounts.
    const addresses = await ethProvider.enable({
      method: "eth_requestAccounts",
    });
    const accountId = await getAccountId(ethProvider, addresses[0]);
    const normAccount = normalizeAccountId(accountId);
    const keySeed = randomBytes(32);
    const didKey = await createDIDKey(keySeed);

    await didKey.authenticate();

    const now = new Date(Date.now());
    const yearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const domain = "index.network";

    const siweMessage = new SiweMessage({
      domain,
      address: getAddress(normAccount.address),
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey.id,
      version: "1",
      chainId: "1",
      nonce: randomString(10),
      issuedAt: now.toISOString(),
      expirationTime: yearLater.toISOString(),
      resources: ["ceramic://*"],
    });
    // Future, these will be stored in CapReg - object-capability registry
    // This feature will allow us to revoke sessions.
    // https://forum.ceramic.network/t/cip-127-capreg-object-capability-registry/1082

    siweMessage.signature = await ethProvider.request({
      method: "personal_sign",
      params: [siweMessage.signMessage(), getAddress(accountId.address)],
    });

    const cacao = Cacao.fromSiweMessage(siweMessage);

    const did = await createDIDCacao(didKey, cacao);
    const didSession = new DIDSession({ cacao, keySeed, did });

    return didSession.serialize();
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
