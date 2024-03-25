import * as LitJsSdk from "@lit-protocol/lit-node-client-nodejs";


class LitNodeClientSingleton {
  constructor() {
    if (!LitNodeClientSingleton.instance) {
      // Inline configuration
      const config = {
        litNetwork: process.env.LIT_NETWORK,
        debug: true,
        checkNodeAttestation: false,
      };

      this.client = new LitJsSdk.LitNodeClientNodeJs(config);
      this.connect();
      LitNodeClientSingleton.instance = this;
    }
    return LitNodeClientSingleton.instance.client;
  }

  async connect() {
    try {
      await this.client.connect();
      console.log('LitNodeClient connected successfully.');
    } catch (error) {
      console.error('Failed to connect LitNodeClient:', error);
    }
  }
}

// Ensuring the object is a singleton
LitNodeClientSingleton.instance = null;

export function getLitNodeClient() {
  if (!LitNodeClientSingleton.instance) {
    return new LitNodeClientSingleton();
  }
  return LitNodeClientSingleton.instance.client;
}
