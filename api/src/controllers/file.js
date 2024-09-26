import { PinataSDK } from "pinata";

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT_KEY,
  pinataGateway: "ipfs.index.network",
});

export const getAvatar = async (req, res, next) => {
  const url = await pinata.gateways.createSignedURL({
    cid: req.params.cid,
    expires: 30000,
  });
  return res.redirect(302, url);
};
export const uploadAvatar = async (req, res, next) => {
  try {
    // Assuming multer is used to handle file uploads and the file is stored temporarily

    const file = new File([req.file.buffer], "profilePicture.jpg", {
      type: req.file.mimetype,
    });

    // Upload the file to IPFS via Pinata
    const result = await pinata.upload.file(file);

    // Respond with the IPFS CID
    res.json({ cid: result.cid });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred while uploading the file to IPFS.");
  }
};
