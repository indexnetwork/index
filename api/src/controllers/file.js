import fs from 'fs'
import pinataSDK  from '@pinata/sdk';
import { Readable } from "stream";


const bufferToStream = (buffer) => {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null); // Indicate end of stream
  return stream;
};

export const uploadAvatar = async (req, res, next) => {

    try {

        const pinata = new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT_KEY});
        // Assuming multer is used to handle file uploads and the file is stored temporarily


        const readableStreamForFile = bufferToStream(req.file.buffer);

        // Add the file to IPFS
        const options = {
            pinataMetadata: {
                name: "profilePicture.jpg",
                keyvalues: {
                    // Add any key-values here you wish to associate with the upload
                }
            },
            pinataOptions: {
                cidVersion: 0
            }
        };

        const result = await pinata.pinFileToIPFS(readableStreamForFile, options);


        // Respond with the IPFS hash
        res.json({ cid: result.IpfsHash });
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred while uploading the file to IPFS.');
    }

}
