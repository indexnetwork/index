"use strict";
(() => {
  // lit_actions/src/session.action.ts
  var getCreatorConditions = (transform = true) => {
    let conditionsArray = __REPLACE_THIS_AS_CONDITIONS_ARRAY__;

    if (conditionsArray.length < 1) {
      return [];
    }

    if (!transform) {
      return conditionsArray;
    }

    return conditionsArray
      .map((c) => c.value)
      .flatMap((v, i) =>
        i < conditionsArray.length - 1 ? [v, { operator: "or" }] : [v],
      )
      .map((v) => {
        delete v.metadata;
        return v;
      });
  };

  var toSiweMessage = (message) => {
    const header = `${message.domain} wants you to sign in with your Ethereum account:`;
    const uriField = `URI: ${message.uri}`;
    let prefix = [header, message.address].join("\n");
    const versionField = `Version: ${message.version}`;
    const chainField = `Chain ID: 1`;
    const nonceField = `Nonce: ${message.nonce}`;
    const suffixArray = [uriField, versionField, chainField, nonceField];

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
        [`Resources:`, ...message.resources.map((x) => `- ${x}`)].join("\n"),
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
    const models = __REPLACE_THIS_AS_MODELS_OBJECT__;
    return isPermittedAddress
      ? [models.Index, models.IndexItem, models.Embedding]
      : [models.IndexItem, models.Embedding];
  };

  var getPKPSessionMessage = (
    publicKey,
    isPermittedAddress,
    didKey,
    domain,
    nonce,
    currentDateTime,
    twentyFiveDaysLater,
  ) => {
    const pkpAddress = ethers.utils.computeAddress(publicKey).toLowerCase();

    const siweMessage = {
      domain,
      address: pkpAddress,
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey,
      version: "1",
      chainId: "1",
      nonce,
      issuedAt: currentDateTime,
      expirationTime: twentyFiveDaysLater,
      resources: getResources(isPermittedAddress).map(
        (m) => `ceramic://*?model=${m}`,
      ),
    };
    return siweMessage;
  };
  var go = async () => {
    try {
      if (typeof ACTION_CALL_MODE !== "undefined") {
        console.log(JSON.stringify(getCreatorConditions(false)));
        return;
      }
      const context = {
        userAuthSig: false,
        isPermittedAddress: false,
        isCreator: false,
        siweMessage: false,
        signList: signList.getPKPSession,
      };
      context.userAuthSig = userAuthSig;
      console.time("pubkeyToTokenId");
      const pkpTokenId = Lit.Actions.pubkeyToTokenId({ publicKey });
      //It'll also fail if authsig is malformed.

      const isValidAuthSig = ethers.utils.verifyMessage(
        userAuthSig.signedMessage,
        userAuthSig.sig,
      );
      if (!isValidAuthSig) {
        LitActions.setResponse({
          response: JSON.stringify({
            error: true,
            context: JSON.stringify({
              message: `authSig is not valid`,
            }),
          }),
        });
        return;
      }

      const isPermittedAddress = await Lit.Actions.isPermittedAddress({
        tokenId: pkpTokenId,
        address: userAuthSig.address,
      });
      context.isPermittedAddress = isPermittedAddress;

      let isCreator = false;
      if (!isPermittedAddress) {
        const conditions = getCreatorConditions();
        if (conditions.length > 0) {
          isCreator = await Lit.Actions.checkConditions({
            conditions,
            authSig: userAuthSig,
            chain,
          });
          context.isCreator = isCreator;
        }
      }

      let signatures = [];

      for (const functionToRun of Object.keys(signList)) {
        const op = signList[functionToRun];

        if (functionToRun === "signTransaction") {
          if (isPermittedAddress) {
            const sigShare = await LitActions.signEcdsa({
              toSign: op.messageToSign,
              publicKey,
              sigName: functionToRun,
            });
            signatures.push(sigShare);
          }
        }

        if (functionToRun === "getPKPSession") {
          if (isPermittedAddress || isCreator) {
            const siwePayload = getPKPSessionMessage(
              publicKey,
              isPermittedAddress,
              op.didKey,
              op.domain,
              nonce,
              currentDateTime,
              twentyFiveDaysLater,
            );
            context.siweMessage = siwePayload;
            const sigShare = await LitActions.ethPersonalSignMessageEcdsa({
              message: toSiweMessage(siwePayload),
              publicKey,
              sigName: functionToRun,
            });
            signatures.push(sigShare);
          }
        }
      }

      const sigShares = signatures;

      LitActions.setResponse({
        response: JSON.stringify({
          error: false,
          context: JSON.stringify(context),
        }),
      });
    } catch (e) {
      console.error(e);
    }
  };
  go();
})();
