import { PinataSDK } from "pinata";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT_KEY,
  pinataGateway: "index-network.mypinata.cloud",
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
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
    const file = new File([req.file.buffer], "profilePicture.jpg", {
      type: req.file.mimetype,
    });

    // Upload to IPFS via Pinata
    const pinataResult = await pinata.upload.file(file);

    // Upload to S3
    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `avatars/${pinataResult.cid}.jpg`,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    await s3Client.send(new PutObjectCommand(s3Params));

    // Respond with both IPFS CID and S3 URL
    res.json({
      cid: pinataResult.cid,
      s3: `https://app-static.index.network/avatars/${pinataResult.cid}.jpg`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred while uploading the file.");
  }
};
