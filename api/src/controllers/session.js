import { Cacao, SiweMessage } from "@didtools/cacao";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { randomBytes } from "crypto";
// export const createSession = async (req, res) => {
//   // const statement = "API Token for indexes.";
//   // const siweMessage = new SiweMessage({
//   //   domain,
//   //   address: wallet.address,
//   //   statement,
//   //   uri: origin,
//   //   version: "1",
//   //   chainId: "1",
//   // });

//   const messageToSign = req.body.siweMessage.toMessage();

//   const signature = await wallet.signMessage(messageToSign);

//   const authSig = {
//     sig: signature,
//     derivedVia: "web3.eth.personal.sign",
//     signedMessage: messageToSign,
//     address: req.body.siweMessage.address,
//   };

//   return authSig;
//   const cacao = Cacao.fromSiweMessage(req.body.siweMessage);
//   const did = await createDIDCacao(didKey, cacao);
//   const newSession = new DIDSession({ cacao, keySeed, did });
// };
export const createSession = async (req, res) => {
  const keySeed = Buffer.from(
    "ZsLysvz2pJAltwqASmNOC2byBTV6yyn5Np8A4T+jQOE=",
    "base64",
  );
  // const keySeed = randomBytes(32);
  const didKey = await createDIDKey(keySeed);
  console.log("didKey", didKey);
  console.log("keySeed", keySeed.toString("base64"));
  // const siweMessage = new SiweMessage({
  //   domain: req.body.domain,
  //   address: req.body.address,
  //   statement: req.body.statement,
  //   uri: req.body.uri,
  //   version: req.body.version,
  //   chainId: req.body.chainId,
  //   nonce: req.body.nonce,
  //   issuedAt: req.body.issuedAt,
  //   expirationTime: req.body.expirationTime,
  //   resources: req.body.resources,
  // });
  const siweMessage = new SiweMessage(req.body.siweMessage);

  // const signature = req.body.siweMessage.signature;
  // const siweMessage = req.body.siweMessage;
  console.log("siweMessage", siweMessage);

  const cacao = Cacao.fromSiweMessage(siweMessage);
  const did = await createDIDCacao(didKey, cacao);
  const newSession = new DIDSession({ cacao, keySeed, did });

  console.log("newSession", newSession);
  console.log("newSession", newSession.authorizations);
  console.log("session", newSession.did.authenticated);

  res.send(newSession.serialize());
};
