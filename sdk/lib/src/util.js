import { Cacao, SiweMessage } from "@didtools/cacao";

export const formatSiweMessage = (siweMessageStr) => {
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
