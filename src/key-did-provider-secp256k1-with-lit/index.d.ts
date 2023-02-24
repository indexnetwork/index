import { Signer } from "did-jwt";
import type { RPCRequest, RPCResponse, SendRequestFunc } from "rpc-utils";
import {
	ContextWithLit, DIDMethodNameWithLit, DIDProviderMethodsWithLit, DIDProviderWithLit, EcdsaSignature,
} from "./interfaces.js";

export declare const litActionSignAndGetSignature: (sha256Payload: Uint8Array, context: ContextWithLit) => Promise<EcdsaSignature>;
export declare function encodeDIDWithLit(PKP_PUBLIC_KEY: string): Promise<string>;
export declare function getPubKeyFromEncodedDID(encodedDID: string): string;
export declare function ES256KSignerWithLit(context: ContextWithLit): Signer;
export declare class Secp256k1ProviderWithLit implements DIDProviderWithLit {
	_handle: SendRequestFunc<DIDProviderMethodsWithLit>;

	constructor(context: { pkpPublicKey: string; ipfsId: string; did: string });
	get isDidProvider(): boolean;
	send<Name extends DIDMethodNameWithLit>(msg: RPCRequest<DIDProviderMethodsWithLit, Name>): Promise<RPCResponse<DIDProviderMethodsWithLit, Name> | null>;
}
