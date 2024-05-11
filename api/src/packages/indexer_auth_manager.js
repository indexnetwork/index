import dotenv from 'dotenv';

import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

// Load environment variables in non-production environments
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

import { Wallet, ethers } from 'ethers';
import * as LitJsSdk from '@lit-protocol/lit-node-client-nodejs';
import { LitContracts } from '@lit-protocol/contracts-sdk';
import { LitAbility, LitPKPResource, LitActionResource } from '@lit-protocol/auth-helpers';

import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { randomBytes, randomString } from "@stablelib/random";

import RedisClient from '../clients/redis.js';
import { generateLITAction } from '../utils/helpers.js';


// Sentry initialization for error tracking and performance monitoring
Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [new ProfilingIntegration()],
    tracesSampleRate: 1.0, // Capture 100% of transactions
    profilesSampleRate: 1.0,
});

// Configuration
const config = {
    litNetwork: process.env.LIT_NETWORK,
    domain: process.env.DOMAIN,
    daysUntilUTCMidnightExpiration: 30,
    requestsPerSecond: 100,
    checkNodeAttestation: false,
    debug: true //!!process.env.DEBUG || false,
};

// Global instances
const redis = RedisClient.getInstance();
const ethProvider = new ethers.providers.JsonRpcProvider(process.env.LIT_PROTOCOL_RPC_PROVIDER);
const indexerWallet = new ethers.Wallet(process.env.INDEXER_WALLET_PRIVATE_KEY, ethProvider);


console.log(`Wallet address: ${indexerWallet.address}`)
const litContracts = new LitContracts({
    network: config.litNetwork,
    privateKey: indexerWallet.privateKey,
});
const litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
    litNetwork: config.litNetwork,
    checkNodeAttestation: config.checkNodeAttestation,
    debug: config.debug,
});

const thirtyDaysLater = new Date(Date.now() + 1000 * 60 * 60 * 24 * config.daysUntilUTCMidnightExpiration)

async function debugToken () {
    const tidi  = "34377241974961642340404714166684286561436613709573157488149117101353173877163";
    await litContracts.connect()
    const authMethods = await litContracts.pkpPermissionsContract.read.getPermittedAuthMethods(tidi );

    var buffer = Buffer.from('QmTWwFrDoVRgxNS6dfYjzquLu5etLDS5VgAe4e3ET332so')
    var hex = buffer.toString('hex')
    console.log(hex)

    const isPermittedAction = await litContracts.pkpPermissionsContractUtils.read.isPermittedAction(
        tidi,
         'QmTWwFrDoVRgxNS6dfYjzquLu5etLDS5VgAe4e3ET332so'
    )
    console.log("lit.authMethods", isPermittedAction)
    const scopes = await litContracts.pkpPermissionsContract.read.getPermittedAuthMethodScopes(
        tidi,
        authMethods[1].authMethodType,
        authMethods[1].id,
        3
    );
    console.log("lit.scopes", scopes)

}

// Functions
async function mintNewCapacityToken() {
    console.log('Minting new capacity token...');
    const { capacityTokenIdStr } = await litContracts.mintCapacityCreditsNFT({
        requestsPerSecond: config.requestsPerSecond,
        daysUntilUTCMidnightExpiration: config.daysUntilUTCMidnightExpiration,
    });
    console.log(`New capacity token minted: ${capacityTokenIdStr}`);
    return capacityTokenIdStr;
}

 async function authNeededCallback ({ resources, expiration, uri }) {
   // you can change this resource to anything you would like to specify
   const litResource = new LitActionResource('*');

   const recapObject =
     await litNodeClient.generateSessionCapabilityObjectWithWildcards([
       litResource,
     ]);

   recapObject.addCapabilityForResource(
     litResource,
     LitAbility.LitActionExecution
   );

   const verified = recapObject.verifyCapabilitiesForResource(
     litResource,
     LitAbility.LitActionExecution
   );

   if (!verified) {
     throw new Error('Failed to verify capabilities for resource');
   }

   let siweMessage = new SiweMessage({
     domain: 'index.network', // change to your domain ex: example.app.com
     address: indexerWallet.address,
     statement: 'Index Network says: ', // configure to what ever you would like
     uri,
     version: '1',
     chainId: '1',
     expirationTime: expiration,
     resources,
   });

   siweMessage = recapObject.addToSiweMessage(siweMessage);

   const messageToSign = siweMessage.toMessage();
   const signature = await indexerWallet.signMessage(messageToSign);

   const authSig = {
     sig: signature,
     derivedVia: 'web3.eth.personal.sign',
     signedMessage: messageToSign,
     address: indexerWallet.address,
   };

   return authSig;
 };


async function generateAndStoreAuthSigs(capacityTokenId) {
    console.log('Generating and storing authorization signatures...');
    const { capacityDelegationAuthSig } = await litNodeClient.createCapacityDelegationAuthSig({
        dAppOwnerWallet: indexerWallet,
        capacityTokenId: capacityTokenId,
        expiration: thirtyDaysLater.toISOString(),
    });

    const dAppSessionSigs = await litNodeClient.getSessionSigs({
        expiration: thirtyDaysLater.toISOString(),
        chain: 'ethereum',
        resourceAbilityRequests: [{ resource: new LitPKPResource('*'), ability: LitAbility.PKPSigning }],
        authNeededCallback: authNeededCallback,
        capacityDelegationAuthSig,
    });

    await redis.set(`lit:${config.litNetwork}:capacityTokenId`, capacityTokenId);
    await redis.set(`lit:${config.litNetwork}:capacityDelegationAuthSig`, JSON.stringify(capacityDelegationAuthSig));
    await redis.set(`lit:${config.litNetwork}:dAppSessionSigs`, JSON.stringify(dAppSessionSigs));

    console.log('Authorization signatures generated and stored.');
}

async function scheduleTokenRefresh() {
    console.log('Starting token refresh schedule...');
    let refresh = false;
    try {
        const capacityTokenId = await redis.get(`lit:${config.litNetwork}:capacityTokenId`);

        if(!capacityTokenId){
          refresh = true;
        }else {
          const capacity = await litContracts.rateLimitNftContractUtils.read.getCapacityByIndex(capacityTokenId);
          console.log(`Current capacity at token ${capacityTokenId}: ${JSON.stringify(capacity)}`);

          const expiresIn = capacity.expiresAt.timestamp * 1000 - Date.now();
          const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
          if(expiresIn <= twoDaysInMs){
            refresh = true;
          }
        }

        if (refresh) {
            console.log('Capacity token is close to expiration. Minting a new one...');
            const newTokenId = await mintNewCapacityToken();
            await generateAndStoreAuthSigs(newTokenId);
            console.log('New capacity token is minted and authorized successfully.');
        } else {
            console.log('Current capacity token is still valid. No action needed.');
        }
    } catch (error) {
        process.exit(1)
    }
}

async function generateDefaultLitActions() {

  const wallet = new Wallet(process.env.INDEXER_WALLET_PRIVATE_KEY);

  const defaultConditions = [
      {
        "tag":"semanticIndex",
        "value":{
            "contractAddress":"",
            "standardContractType":"",
            "chain":"ethereum",
            "method":"",
            "parameters":[
              ":userAddress"
            ],
            "returnValueTest":{
              "comparator":"=",
              "value": wallet.address
            }
        }
      }
  ]
  const defaultCID = await generateLITAction(defaultConditions)
  console.log("Default CID", defaultCID)
}

async function refreshIndexerDIDSession () {

  const keySeed = randomBytes(32);
  const didKey = await createDIDKey(keySeed);

  const now = new Date();

  const siweMessage = new SiweMessage({
    domain: process.env.DOMAIN,
    address: indexerWallet.address,
    statement: "Give this application access to some of your data on Ceramic",
    uri: didKey.id,
    version: "1",
    chainId: "1",
    nonce: randomString(10),
    issuedAt: now.toISOString(),
    expirationTime: thirtyDaysLater.toISOString(),
    resources: ["ceramic://*"],
  });

  siweMessage.signature = await indexerWallet.signMessage(siweMessage.toMessage());

  const cacao = Cacao.fromSiweMessage(siweMessage);
  const did = await createDIDCacao(didKey, cacao);
  const newSession = new DIDSession({ cacao, keySeed, did });
  await redis.set(`indexer:did:session`, newSession.serialize());
  console.log("New DID Session for indexer saved to Redis")
}

async function run () {

  await redis.connect();
  await litNodeClient.connect();
  await litContracts.connect();

  await refreshIndexerDIDSession();
  await scheduleTokenRefresh();
  process.exit(0)
}

generateDefaultLitActions()
