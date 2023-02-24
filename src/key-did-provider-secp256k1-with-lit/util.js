import * as u8a from 'uint8arrays';
import { base64ToBytes } from 'did-jwt';
import stringify from 'fast-json-stable-stringify';
import { hash } from '@stablelib/sha256';
export function sha256(payload) {
    const data = typeof payload === 'string' ? u8a.fromString(payload) : payload;
    return hash(data);
}
export function bytesToBase64url(b) {
    return u8a.toString(b, 'base64url');
}
export function encodeBase64url(s) {
    return bytesToBase64url(u8a.fromString(s));
}
export function bytesToHex(b) {
    return u8a.toString(b, 'base16');
}
export function toStableObject(obj) {
    return JSON.parse(stringify(obj));
}
export function toGeneralJWS(jws) {
    const [protectedHeader, payload, signature] = jws.split('.');
    return {
        payload,
        signatures: [{ protected: protectedHeader, signature }],
    };
}
export function toJose({ r, s, recoveryParam }, recoverable) {
    const jose = new Uint8Array(recoverable ? 65 : 64);
    jose.set(u8a.fromString(r, 'base16'), 0);
    jose.set(u8a.fromString(s, 'base16'), 32);
    if (recoverable) {
        if (typeof recoveryParam === 'undefined') {
            throw new Error('Signer did not return a recoveryParam');
        }
        jose[64] = recoveryParam;
    }
    return bytesToBase64url(jose);
}
export function fromJose(signature) {
    const signatureBytes = base64ToBytes(signature);
    if (signatureBytes.length < 64 || signatureBytes.length > 65) {
        throw new TypeError(`Wrong size for signature. Expected 64 or 65 bytes, but got ${signatureBytes.length}`);
    }
    const r = bytesToHex(signatureBytes.slice(0, 32));
    const s = bytesToHex(signatureBytes.slice(32, 64));
    const recoveryParam = signatureBytes.length === 65 ? signatureBytes[64] : undefined;
    return { r, s, recoveryParam };
}
export function instanceOfEcdsaSignature(object) {
    return typeof object === 'object' && 'r' in object && 's' in object;
}
export function getInstanceType(value) {
    if (value instanceof Object) {
        if (value.constructor.name == 'Object') {
            return 'Object';
        }
        return value.constructor.name;
    }
    return typeof value;
}
;
export function log(name, value = null, printObj = false) {
    const PREFIX = '[key-did-provider-secp256k1]';
    const STYLE = 'color: #5FA227';
    if (value !== null) {
        const instanceType = getInstanceType(value);
        let text;
        try {
            text = JSON.stringify(value);
        }
        catch (e) {
            text = '';
        }
        if (printObj == false) {
            console.log(`%c${PREFIX}: ${name}${instanceType != null ? `(${instanceType})` : ''} "${text}"`, `${STYLE}`);
            return;
        }
        console.log(`%c${PREFIX}: ${name}${instanceType != null ? `(${instanceType})` : ''}`, `${STYLE}`);
        console.log(value);
        return;
    }
    console.log(`[key-did-provider-secp256k1]: ${name}$`);
}
//# sourceMappingURL=util.js.map