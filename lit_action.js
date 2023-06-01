/**
 *
 * NAME: session
 *
 */

"use strict";
(() => {
  // lit_actions/src/session.action.ts
  var getCreatorConditions = () => {
    return __REPLACE_THIS_AS_CONDITIONS_ARRAY__;
  };
  var toSiweMessage = (message) => {
    const header = `${message.domain} wants you to sign in with your Ethereum account:`;
    const uriField = `URI: ${message.uri}`;
    let prefix = [header, message.address].join("\n");
    const versionField = `Version: ${message.version}`;
    const chainField = `Chain ID: ` + message.chainId || "1";
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
      "Index": "kjzl6hvfrbw6c8e8rlhx3guuoc1o6i4vni5emzh2c48aa5pn0u71jggun7rtu2a",
      "IndexLink": "kjzl6hvfrbw6c6vpgfoph7e98nkj4ujmd7bgw5ylb6uzmpts1yjva3zdjk0bhe9"
    };
    return isPermittedAddress ? [models.Index, models.IndexLink] : [models.IndexLink];
  };
  var go = async () => {
    if (typeof ACTION_CALL_MODE !== "undefined") {
      console.log(JSON.stringify(getCreatorConditions()));
      return;
    }
    const context = { isPermittedAddress: false, isCreator: false, siweMessage: false };
    const pkpTokenId = Lit.Actions.pubkeyToTokenId({ publicKey });
    const pkpAddress = ethers.utils.computeAddress(publicKey).toLowerCase();
    const isPermittedAddress = await Lit.Actions.isPermittedAddress({ tokenId: pkpTokenId, address: Lit.Auth.authSigAddress });
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
      const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1e3);
      const siweMessage = {
        domain,
        address: pkpAddress,
        statement: "Give this application access to some of your data on Ceramic",
        uri: didKey,
        version: "1",
        chainId: "175177",
        nonce,
        issuedAt: now.toISOString(),
        expirationTime: threeMonthsLater.toISOString(),
        resources: getResources(isPermittedAddress).map((m) => `ceramic://*?model=${m}`)
      };
      const sigShare = await LitActions.ethPersonalSignMessageEcdsa({
        message: toSiweMessage(siweMessage),
        publicKey,
        sigName
      });
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
