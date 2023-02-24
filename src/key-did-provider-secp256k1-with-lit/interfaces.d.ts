import type {
	AuthParams, CreateJWSParams, GeneralJWS, DecryptJWEParams,
} from "dids";
import { RPCConnection } from "rpc-utils";

export interface ContextWithLit {
    did: string;
    ipfsId?: string;
    litCode?: string;
}
export interface EcdsaSignature {
    r: string;
    s: string;
    recoveryParam?: number | null;
}
export interface JWSCreationOptions {
    canonicalize?: boolean;
}
export declare type DIDProviderMethodsWithLit = {
    did_authenticate: {
        params: AuthParams;
        result: GeneralJWS;
    };
    did_createJWS: {
        params: CreateJWSParams;
        result: {
            jws: GeneralJWS;
        };
    };
    did_decryptJWE: {
        params: DecryptJWEParams;
        result: {
            cleartext: string;
        };
    };
};
export declare type DIDMethodNameWithLit = keyof DIDProviderMethodsWithLit;
export declare type DIDProviderWithLit = RPCConnection<DIDProviderMethodsWithLit>;
export interface IPFSData {
    path: string;
    url: string;
}
