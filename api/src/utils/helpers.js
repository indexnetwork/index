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


export const removePrefixFromKeys = (obj, prefix) => {
    return Object.keys(obj).reduce((newObj, key) => {
        // Check if the key starts with the prefix and adjust it if necessary
        const newKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
        newObj[newKey] = obj[key];  // Assign the value to the possibly adjusted key
        return newObj;
    }, {});
};
