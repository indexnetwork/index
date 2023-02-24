import type { GeneralJWS } from "dids";
import { EcdsaSignature } from "./interfaces";

export declare function sha256(payload: string | Uint8Array): Uint8Array;
export declare function bytesToBase64url(b: Uint8Array): string;
export declare function encodeBase64url(s: string): string;
export declare function bytesToHex(b: Uint8Array): string;
export declare function toStableObject(obj: Record<string, any>): Record<string, any>;
export declare function toGeneralJWS(jws: string): GeneralJWS;
export declare function toJose({ r, s, recoveryParam }: EcdsaSignature, recoverable?: boolean): string;
export declare function fromJose(signature: string): {
    r: string;
    s: string;
    recoveryParam?: number;
};
export declare function instanceOfEcdsaSignature(object: any): object is EcdsaSignature;
export declare function getInstanceType(value: any): any;
export declare function log(name: string, value?: any, printObj?: boolean): void;
