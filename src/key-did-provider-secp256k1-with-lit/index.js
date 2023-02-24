import { createJWS } from "did-jwt";
import { RPCError, createHandler } from "rpc-utils";
import * as u8a from "uint8arrays";
import elliptic from "elliptic";
import LitJsSdk from "lit-js-sdk";
import { toGeneralJWS, toJose, toStableObject, sha256, log } from "./util.js";

import * as dagCBOR from '@ipld/dag-cbor';
import { fromString } from 'uint8arrays/from-string';
import * as Block from 'multiformats/block';
import { sha256 as hasherSha256 } from 'multiformats/hashes/sha2';

const ec = new elliptic.ec("secp256k1");

export const litActionSignAndGetSignature = async (sha256Payload, context) => {
    log("[litActionSignAndGetSignature] sha256Payload: ", sha256Payload);
    const authSig = await LitJsSdk.checkAndSignAuthMessage({ chain: "mumbai" });
    log("[litActionSignAndGetSignature] authSig:", authSig);
    const litNodeClient = new LitJsSdk.LitNodeClient({ litNetwork: "serrano" });
    await litNodeClient.connect();
    log("[litActionSignAndGetSignature] ipfsId:", context.ipfsId);
    const jsParams = {
        toSign: Array.from(sha256Payload),
        publicKey: getPubKeyFromEncodedDID(context.did),
        sigName: "sig1",
    };
    log("[litActionSignAndGetSignature] jsParams:", jsParams);
    const executeOptions = {
        ...(context.ipfsId === undefined || !context.ipfsId) && { code: context.litCode },
        ...(context.litCode === undefined || !context.litCode) && { ipfsId: context.ipfsId },
        authSig,
        jsParams,
    };
    const res = await litNodeClient.executeJs(executeOptions);
    log("[litActionSignAndGetSignature] res.signatures:", res.signatures);
    const signature = res.signatures;
    return {
        r: signature.sig1.r,
        s: signature.sig1.s,
        recoveryParam: signature.sig1.recid,
    };
};
export async function encodeDIDWithLit(PKP_PUBLIC_KEY) {
    const pkpPubKey = PKP_PUBLIC_KEY.replace('0x', '');
    log("[encodeDIDWithLit] pkpPubKey:", pkpPubKey);
    const pubBytes = ec
        .keyFromPublic(pkpPubKey, "hex")
        .getPublic(true, "array");
    log("[encodeDIDWithLit] pubBytes:", pubBytes);
    const bytes = new Uint8Array(pubBytes.length + 2);
    bytes[0] = 0xe7;
    bytes[1] = 0x01;
    bytes.set(pubBytes, 2);
    log("[encodeDIDWithLit] bytes:", bytes);
    const did = `did:key:z${u8a.toString(bytes, "base58btc")}`;
    log(`[encodeDIDWithLit] did:`, did);
    return did;
}
export function getPubKeyFromEncodedDID(encodedDID) {
   // log("[getPubKeyFromEncodedDID] encodedDID:", encodedDID);
    const arr = encodedDID?.split(':');
    if (arr[0] != 'did')
        throw Error('string should start with did:');
    if (arr[1] != 'key')
        throw Error('string should start with did:key');
    if (arr[2].charAt(0) !== 'z')
        throw Error('string should start with did:key:z');
    const str = arr[2].substring(1);
    ;
    //log("[getPubKeyFromEncodedDID] str:", str);
    const bytes = u8a.fromString(str, "base58btc");
    const originalBytes = new Uint8Array(bytes.length - 2);
    bytes.forEach((_, i) => {
        originalBytes[i] = bytes[i + 2];
    });
    //log("[getPubKeyFromEncodedDID] originalBytes:", originalBytes);
    const pubPoint = ec.keyFromPublic(originalBytes).getPublic();
    let pubKey = pubPoint.encode('hex', false);
    pubKey = pubKey.charAt(0) == '0' ? pubKey.substring(1) : pubKey;
    //log("[getPubKeyFromEncodedDID] pubKey:", pubKey);
    return '0x0' + pubKey;
}
export function ES256KSignerWithLit(context) {
    log("[ES256KSignerWithLit]");
    const recoverable = false;
    return async (payload) => {
        const encryptedPayload = sha256(payload);
        //log("[ES256KSignerWithLit] encryptedPayload:", encryptedPayload);
        const signature = await litActionSignAndGetSignature(encryptedPayload, context);
        //log("[ES256KSignerWithLit] signature:", signature);
        return toJose(signature, recoverable);
    };
}

const signWithLit = async (payload, context) => {
    const did = context.did;
    log("[signWithLit] did:", did);
    const kid = `${did}#${did.split(":")[2]}`;
    //log("[signWithLit] kid:", kid);
    const protectedHeader = {};
    const header = toStableObject(Object.assign(protectedHeader, { kid, alg: "ES256K" }));
    //log("[signWithLit] header:", header);
    //log("[signWithLit] payload:", payload);
    return createJWS(typeof payload === "string" ? payload : toStableObject(payload), ES256KSignerWithLit(context), header);
};


const didMethodsWithLit = {
    did_authenticate: async (contextParam, params) => {
        const payload = {
            did: contextParam.did,
            aud: params.aud,
            nonce: params.nonce,
            paths: params.paths,
            exp: Math.floor(Date.now() / 1000) + 600,
        };
        //log("----- [did_authenticate] ----- ");
        //log("[didMethodsWithLit] payload:", payload);

        const response = await signWithLit(payload, contextParam);
        //log("[didMethodsWithLit] response:", response);
        const general = toGeneralJWS(response);
        //log("[didMethodsWithLit] general:", general);
        return general;
    },
    did_createJWS: async (contextParam, params) => {
        //console.log("furkan" ,contextParam, params)
        //log("----- [did_createJWS] ----- ");
        const requestDid = params.did.split("#")[0];
        //log("[did_createJWS] requestDid:", requestDid);
        if (requestDid !== contextParam.did)
            throw new RPCError(4100, `Unknown DID: ${contextParam.did}`);

        /*
        const { cid , linkedBlock  } = await encodePayload(payload);
        const payloadCid = encodeBase64Url(cid.bytes);
        Object.assign(options, {
            linkedBlock: encodeBase64(linkedBlock)
        });
        */

        //Haha!

        let originalPayload = fromString(params.linkedBlock, "base64pad");
        let originalBlock = await Block.encode({ value: originalPayload, codec: dagCBOR, hasher: hasherSha256 });
        let recovered = {
            toSign: u8a.toString(originalBlock.cid.bytes, 'base64url'),
            data: dagCBOR.decode(originalPayload)
        }
         
        console.log("recovered", recovered)
        contextParam.originalData = originalPayload
        //if(recovered.data.header.controllers == )

        const jws = await signWithLit(params.payload, contextParam);
        //log("[did_createJWS] jws:", jws);
        return { jws: toGeneralJWS(jws) };
    },
    did_decryptJWE: async () => {
        return { cleartext: "" };
    },
};
export class Secp256k1ProviderWithLit {
    constructor(context) {
        const handler = createHandler(didMethodsWithLit);
        this._handle = async (msg) => {
            log("[Secp256k1ProviderWithLit] this._handle(msg):", msg);
            const _handler = await handler(context, msg);
            return _handler;
        };
    }
    get isDidProvider() {
        return true;
    }
    async send(msg) {
        return await this._handle(msg);
    }
}
//# sourceMappingURL=index.js.map
