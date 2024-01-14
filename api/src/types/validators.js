import { StreamID } from '@ceramicnetwork/streamid';
import { CID } from 'multiformats/cid'
import { ethers } from "ethers";

import { DID } from 'dids'
import KeyResolver from 'key-did-resolver'
import multer from "multer";


export const isStreamID = (value, helpers) => {
    try {
        return StreamID.fromString(value).toString();
    } catch (e) {
        return helpers.message('Invalid Stream ID');
    }
};

export const isDID = (value, helpers) => {
    try {
        const did = new DID({ resolver: KeyResolver.getResolver() })
        return value
    } catch (e) {
        return helpers.message('Invalid Stream ID');
    }
};

export const isCID = (value, helpers) => {
    try {
        return CID.parse(value).toString();
    } catch (e) {
        return helpers.message('Invalid CID');
    }
};

export const isPKPPublicKey = (value, helpers) => {
    try {
        ethers.computeAddress(value);
        return value;
    } catch (e) {
        return helpers.message('Invalid Pkp Public Key');
    }
};


export const isValidURL = (url) => {
    try {
        new URL(url);
        return true;
    } catch (error) {
        return false;
    }
};

export const isImage = multer({
    fileFilter: function (req, file, cb) {
        // Check if the file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Not an image. Please upload an image file.'), false);
        }
    }
});
