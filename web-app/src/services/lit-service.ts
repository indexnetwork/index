import { LitContracts } from "@lit-protocol/contracts-sdk";
import { CID } from "multiformats/cid";
import { SiweMessage } from "@didtools/cacao";
import { ethers } from "ethers";
import { appConfig } from "../config";

class LitService {
  async mintPKP() {
    const litContracts = new LitContracts({
      network: appConfig.litNetwork,
    });
    await litContracts.connect();

    const signerFunctionV0 = CID.parse(appConfig.defaultCID).toV0().toString();
    const acid = litContracts.utils.getBytesFromMultihash(signerFunctionV0);

    const mintCost = await litContracts.pkpNftContract.read.mintCost();
    const mint =
      (await litContracts.pkpHelperContract.write.mintNextAndAddAuthMethods(
        2,
        [2],
        [acid],
        ["0x"],
        [[BigInt(1)]],
        true,
        false,
        {
          value: mintCost,
        },
      )) as any;
    const wait = await mint.wait();

    /* eslint-disable */
    const tokenIdFromEvent = wait?.logs
      ? wait.logs[0].topics[1]
      : wait?.logs[0].topics[1];
    const tokenIdNumber = BigInt(tokenIdFromEvent).toString();
    const pkpPublicKey =
      await litContracts.pkpNftContract.read.getPubkey(tokenIdFromEvent);

    /*
    const authMethods = await litContracts.pkpPermissionsContract.read.getPermittedAuthMethods(tokenIdFromEvent );

    console.log("lit.authMethods", authMethods[0])
    const scopes = await litContracts.pkpPermissionsContract.read.getPermittedAuthMethodScopes(
        tokenIdFromEvent,
        authMethods[0].authMethodType,
        authMethods[0].id,
        3
    );
    console.log("lit.scopes", scopes)
     */

    console.log(
      `superlog, PKP public key is ${pkpPublicKey} and Token ID is ${tokenIdFromEvent} and Token ID number is ${tokenIdNumber}`,
    );

    return {
      tokenIdFromEvent,
      tokenIdNumber,
      pkpPublicKey,
    };
  }

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

  async writeAuthMethods({ newCID, prevCID, signerPublicKey }: any) {
    const litContracts = new LitContracts({
      network: appConfig.litNetwork,
    });
    await litContracts.connect();
    const prevCIDV0 = CID.parse(prevCID).toV0().toString();
    const pubKeyHash = ethers.keccak256(signerPublicKey!);
    const tokenId = BigInt(pubKeyHash);
    const newCollabAction = litContracts.utils.getBytesFromMultihash(newCID);
    const previousCollabAction =
      litContracts.utils.getBytesFromMultihash(prevCIDV0);

    await litContracts.pkpPermissionsContract.write.batchAddRemoveAuthMethods(
      tokenId,
      [2],
      [newCollabAction],
      ["0x"],
      [[BigInt(1)]],
      [2],
      [previousCollabAction],
    );
  }

  checkAndSignAuthMessage() {
    JSON.parse(localStorage.getItem("authSig")!);
  }
}
const litService = new LitService();
export default litService;
