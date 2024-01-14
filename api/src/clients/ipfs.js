import {create} from "ipfs-http-client";

const projectId = process.env.INFURA_PROJECT_ID;
const projectSecret = process.env.INFURA_PROJECT_SECRET;

const auth =
    'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');

const IPFSClient = create({
    host: 'ipfs.infura.io',
    port: 5001,
    protocol: 'https',
    headers: {
        authorization: auth,
    },
});

export default IPFSClient;
