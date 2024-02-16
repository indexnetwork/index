import { LitContracts } from "@lit-protocol/contracts-sdk";
import { CID } from "multiformats/cid";
import { appConfig } from "../config";

const checkAndSignAuthMessage = async () =>
  JSON.parse(localStorage.getItem("authSig")!);

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
}
const litService = new LitService();
export default litService;
