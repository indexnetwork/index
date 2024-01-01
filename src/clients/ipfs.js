import { create } from "ipfs-http-client";

const projectId = process.env.INFURA_PROJECT_ID;
const projectSecret = process.env.INFURA_PROJECT_SECRET;

const authorization =
    'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');

const IPFSClient = create({
    host: 'ipfs.infura.io',
    port: 5001,
    protocol: 'https',
    headers: { authorization },
});

export default IPFSClient;
