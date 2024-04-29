import { Cacao } from "@didtools/cacao";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { formatSiweMessage } from "./util";

const session = async (siweMessageStr, signature, keySeedStr) => {
  const keySeed = Buffer.from(keySeedStr, "base64");
  const didKey = await createDIDKey(keySeed);

  const siweMessage = formatSiweMessage(siweMessageStr);

  siweMessage.signature = signature;

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
    return "Method not found. Available methods: key, session";
  }
}

const args = Bun.argv.slice(2);
const method = args[0];
const parameters = args.slice(1);

const result = await main(method, ...parameters);
console.log(result);
