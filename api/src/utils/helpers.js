import { SiweMessage } from "@didtools/cacao";
import { getAddress } from "@ethersproject/address";
import moment from "moment";
import fs from 'fs/promises';

import {definition as definitionDev} from "../types/merged-runtime-dev.js";
import {definition as definitionMainnet} from "../types/merged-runtime-mainnet.js";

import  pinataSDK from '@pinata/sdk';

import { Readable } from "stream";


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

export const generateLITAction = async (conditions) => {

  let actionStr = await fs.readFile(`src/types/template-lit-action.js`, 'utf8');

    actionStr = actionStr.replace('__REPLACE_THIS_AS_CONDITIONS_ARRAY__', JSON.stringify(conditions));

    const definition = getTypeDefinitions()

    const models = JSON.stringify({
      "Index": definition.models.Index.id,
      "IndexItem": definition.models.IndexItem.id,
      "Embedding": definition.models.Embedding.id
    })

    actionStr = actionStr.replace('__REPLACE_THIS_AS_MODELS_OBJECT__', models);

    const pinata = new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT_KEY});

    const buffer = Buffer.from(actionStr, "utf8");
		const stream = Readable.from(buffer);

		stream.path = "string.txt";

		const resp = await pinata.pinFileToIPFS(stream,{
		  pinataMetadata: { name: "signerFunction" }
		})
		return resp.IpfsHash

}
