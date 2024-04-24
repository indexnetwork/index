import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { Cacao, SiweMessage } from "@didtools/cacao";

const formatSiweMessage = (siweMessageStr) => {
  const siweMessage = new SiweMessage(JSON.parse(siweMessageStr));
  if (siweMessage.chain_id) {
    siweMessage.chainId = siweMessage.chain_id;
    delete siweMessage.chain_id;
  }

  if (siweMessage.issued_at) {
    siweMessage.issuedAt = siweMessage.issued_at;
    delete siweMessage.issued_at;
  }

  if (siweMessage.expiration_time) {
    siweMessage.expirationTime = siweMessage.expiration_time;
    delete siweMessage.expiration_time;
  }

  return siweMessage;
};

const session = async (siweMessageStr, signature, keySeedStr) => {
  // console.log("siweMessageStr", siweMessageStr);
  const keySeed = Buffer.from(keySeedStr, "base64");
  const didKey = await createDIDKey(keySeed);

  const siweMessage = formatSiweMessage(siweMessageStr);

  siweMessage.signature = signature;
  // console.log("siweMessage", siweMessage);

  const cacao = Cacao.fromSiweMessage(siweMessage);
  const did = await createDIDCacao(didKey, cacao);
  const newSession = new DIDSession({ cacao, keySeed, did });

  return newSession.serialize();
};

// keySeed as base64 of Buffer
const key = async (keySeed) => {
  const didKey = await createDIDKey(Buffer.from(keySeed, "base64"));
  return didKey.id;
};

function main(method, ...params) {
  const actions = {
    key,
    session,
  };

  if (actions[method]) {
    return actions[method](...params);
  } else {
    return "Method not found. Available methods: greet, add, multiply";
  }
}

const args = Bun.argv.slice(2);
const method = args[0];
const parameters = args.slice(1);

const result = await main(method, ...parameters);
console.log(result);
