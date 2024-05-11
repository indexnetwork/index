import { SiweMessage } from "@didtools/cacao";
import { getAddress } from "@ethersproject/address";
import moment from "moment";

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
