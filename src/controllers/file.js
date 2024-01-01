import IPFSClient from "../clients/ipfs.js";

export const uploadAvatar = async (req, res, next) => {
    try {
        // Get the uploaded file from the request
        const file = req.file;

        // Add the file to IPFS
        const addedFile = await IPFSClient.add({ path: file.originalname, content: file.buffer });

        // Respond with the IPFS hash
        res.json({ cid: addedFile.cid.toString() });
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred while uploading the file to IPFS.');
    }
}
