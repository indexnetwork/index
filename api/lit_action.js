/**
 *
 * NAME: session
 *
 */

"use strict";
(() => {
  // lit_actions/src/session.action.ts
  var getCreatorConditions = (transform=true) => {
    let conditionsArray = __REPLACE_THIS_AS_CONDITIONS_ARRAY__;
    if(conditionsArray.length < 1){
      return [];
    }

    if(!transform){
      return conditionsArray
    }

    return conditionsArray
      .map(c => c.value)
      .flatMap((v, i) => i < conditionsArray.length - 1 ? [v, {"operator": "or"}] : [v])
      .map(v => {
        delete v.metadata
        return v
      })
  };
  var toSiweMessage = (message) => {
    const header = `${message.domain} wants you to sign in with your Ethereum account:`;
    const uriField = `URI: ${message.uri}`;
    let prefix = [header, message.address].join("\n");
    const versionField = `Version: ${message.version}`;
    const chainField = `Chain ID: 1`;
    //const chainField = `Chain ID: ` + message.chainId || "1";
    const nonceField = `Nonce: ${message.nonce}`;
    const suffixArray = [uriField, versionField, chainField, nonceField];
    message.issuedAt = message.issuedAt || (/* @__PURE__ */ new Date()).toISOString();
    suffixArray.push(`Issued At: ${message.issuedAt}`);
    if (message.expirationTime) {
      const expiryField = `Expiration Time: ${message.expirationTime}`;
      suffixArray.push(expiryField);
    }
    if (message.notBefore) {
      suffixArray.push(`Not Before: ${message.notBefore}`);
    }
    if (message.requestId) {
      suffixArray.push(`Request ID: ${message.requestId}`);
    }
    if (message.resources) {
      suffixArray.push(
          [`Resources:`, ...message.resources.map((x) => `- ${x}`)].join("\n")
      );
    }
    const suffix = suffixArray.join("\n");
    prefix = [prefix, message.statement].join("\n\n");
    if (message.statement) {
      prefix += "\n";
    }
    return [prefix, suffix].join("\n");
  };
  var getResources = (isPermittedAddress = false) => {
    const models = {
      "Index": "kjzl6hvfrbw6c6wr91bqjojw1znltqso445kevew3hiywjl1ior4fga60arj9xo",
      "IndexItem": "kjzl6hvfrbw6c66p7dxhk35uass66v2q42b2sdbaw7smitphfv60y9tux4obxu4",
      "Embedding": "kjzl6hvfrbw6c5wx4eb9mmw2su1q7y4m65wd8m887ulubbfn5iawpy6ukprq4va"
    };
    return isPermittedAddress ? [models.Index, models.IndexItem, models.Embedding] : [models.IndexItem, models.Embedding];
  };
  var go = async () => {
    if (typeof ACTION_CALL_MODE !== "undefined") {
      console.log(JSON.stringify(getCreatorConditions(false)));
      return;
    }
    const context = { isPermittedAddress: false, isCreator: false, siweMessage: false };
    const pkpTokenId = Lit.Actions.pubkeyToTokenId({ publicKey });
    const pkpAddress = ethers.utils.computeAddress(publicKey).toLowerCase();
    const isPermittedAddress = await Lit.Actions.isPermittedAddress({ tokenId: pkpTokenId, address: authSig.address });
    context.isPermittedAddress = isPermittedAddress;
    const conditions = getCreatorConditions();
    let isCreator = false;
    if (conditions.length > 0) {
      isCreator = await Lit.Actions.checkConditions({ conditions, authSig, chain });
      context.isCreator = isCreator;
    }
    if (isPermittedAddress || isCreator) {
      const now = /* @__PURE__ */ new Date();
      now.setUTCHours(0, 0, 0, 0);
      const twentyFiveDaysLater = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1e3);
      const siweMessage = {
        domain,
        address: pkpAddress,
        statement: "Give this application access to some of your data on Ceramic",
        uri: didKey,
        version: "1",
        chainId: "1",
        nonce,
        issuedAt: now.toISOString(),
        expirationTime: twentyFiveDaysLater.toISOString(),
        resources: getResources(isPermittedAddress).map((m) => `ceramic://*?model=${m}`)
      };
      const sigShare = await LitActions.ethPersonalSignMessageEcdsa({
        message: toSiweMessage(siweMessage),
        publicKey,
        sigName
      });
      context.litAuth = Lit.Auth;
      context.siweMessage = siweMessage;
      LitActions.setResponse({
        response: JSON.stringify({
          error: false,
          context: JSON.stringify(context)
        })
      });
    } else {
      LitActions.setResponse({
        response: JSON.stringify({
          code: 401,
          context: JSON.stringify(context)
        })
      });
    }
  };
  go();
})();
