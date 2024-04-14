import { SiweMessage } from "@didtools/cacao";
import { getAddress } from "@ethersproject/address";

export const getAuthSigFromDIDSession = (session) => {
  return {
  	signedMessage: SiweMessage.fromCacao(session.cacao).toMessage(),
  	address: getAddress(session.did.parent.split(":").pop()),
  	derivedVia: "web3.eth.personal.sign",
  	sig: session.cacao.s.s,
  };
}
