import { SiweMessage } from "@didtools/cacao";
import { getAddress } from "@ethersproject/address";
import moment from "moment";


import definitionDev from "../types/merged-runtime-dev.js";
import definitionMainnet from "../types/merged-runtime-mainnet.js";

export const getCurrentDateTime = () => moment.utc().toISOString();

export const getAuthSigFromDIDSession = (session) => {
  return {
  	signedMessage: SiweMessage.fromCacao(session.cacao).toMessage(),
  	address: getAddress(session.did.parent.split(":").pop()),
  	derivedVia: "web3.eth.personal.sign",
  	sig: session.cacao.s.s,
  };
}

export const removePrefixFromKeys = (obj, prefix) =>
    Object.keys(obj).reduce((newObj, key) => ({
        ...newObj,
        [key.startsWith(prefix) ? key.slice(prefix.length) : key]: obj[key]
    }), {});


export const getTypeDefinitions = () => {
  const environment = process.env.ENVIRONMENT || "dev";

  switch (environment) {
    case "mainnet":
      return definitionMainnet;
    case "dev":
      return definitionDev;
    default:
      return definitionDev;
  }
};
