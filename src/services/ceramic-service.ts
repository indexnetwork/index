import { Resolver } from "did-resolver";
import { DID } from "dids";
import KeyDidResolver from "key-did-resolver";

import {
	EthereumAuthProvider,
	ThreeIdConnect,
} from "@3id/connect";
import ThreeIdResolver from "@ceramicnetwork/3id-did-resolver";
import { CeramicClient } from "@ceramicnetwork/http-client";

const endpoint = "https://ceramic-clay.3boxlabs.com";

class CeramicService {
	private ceramic?: CeramicClient;

	async authenticate(account: string): Promise<boolean> {
		try {
			this.ceramic = new CeramicClient(endpoint);
			const threeIdConnect = new ThreeIdConnect();
			const authProvider = new EthereumAuthProvider((window as any).ethereum, account);
			await threeIdConnect.connect(authProvider);

			const resolver = new Resolver({
				...ThreeIdResolver.getResolver(this.ceramic!),
				...KeyDidResolver.getResolver(),
			});

			const provider = await threeIdConnect.getDidProvider();

			const did = new DID({ resolver, provider });

			await this.ceramic?.setDID(did);
			await this.ceramic?.did?.authenticate();
			return true;
		} catch (err) {
			console.log(err);
			return false;
		}
	}

	isAuthenticated() {
		return !!(this.ceramic?.did?.authenticated);
	}
}

const ceramicService = new CeramicService();

export default ceramicService;
