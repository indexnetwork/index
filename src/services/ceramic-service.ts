// import { DID } from "dids";
// import { TileDocument } from "@ceramicnetwork/stream-tile";

// import {
// 	EthereumAuthProvider,
// 	ThreeIdConnect,
// } from "@3id/connect";
// import { CeramicClient } from "@ceramicnetwork/http-client";
// import { getResolver as get3IDResolver } from "@ceramicnetwork/3id-did-resolver";
// import { getResolver as getKeyResolver } from "key-did-resolver";
// import { Indexes } from "types/entity";
// import { isSSR } from "utils/helper";
// import moment from "moment";

// // const endpoint = "https://ceramic-clay.3boxlabs.com";
// const endpoint = "http://localhost:7007/";

// class CeramicService {
// 	private client?: CeramicClient;
// 	private account?: string;

// 	get ceramic() {
// 		return this.client;
// 	}

// 	async authenticate(account: string): Promise<boolean> {
// 		if (!isSSR()) {
// 			try {
// 				this.account = account;
// 				this.client = new CeramicClient(endpoint);
// 				const threeIdConnect = new ThreeIdConnect();
// 				const authProvider = new EthereumAuthProvider((window as any).ethereum, account);
// 				await threeIdConnect.connect(authProvider);
// 				const did = new DID({
// 					provider: threeIdConnect.getDidProvider(),
// 					resolver: {
// 						...get3IDResolver(this.client),
// 						...getKeyResolver(),
// 					},
// 				});

// 				// await did.authenticate();

// 				await this.client?.setDID(did);
// 				await this.client?.did?.authenticate();
// 				(window as any).ceramic = this.client;
// 				return true;
// 			} catch (err) {
// 				return false;
// 			}
// 		}
// 		return false;
// 	}

// 	isAuthenticated() {
// 		return !!(this.client?.did?.authenticated);
// 	}

// 	async createIndex(data: Partial<Indexes>): Promise<Indexes | null> {
// 		try {
// 			this.setDates(data);
// 			// eslint-disable-next-line no-debugger
// 			debugger;
// 			const doc = await TileDocument.create<Partial<Indexes>>(this.client!, data, {
// 				family: `index-as-${this.account || ""}`,
// 			});
// 			// eslint-disable-next-line no-debugger
// 			debugger;

// 			return {
// 				...doc.content as any,
// 				streamId: doc.id!.toString(),
// 			};
// 		} catch (err) {
// 			console.log(err);
// 			return null;
// 		}
// 	}

// 	async updateIndex(streamId: string, content: Partial<Indexes>) {
// 		this.setDates(content, true);
// 		const oldDoc = await this.getIndexById(streamId);
// 		await oldDoc.update(content, oldDoc.metadata, {
// 			publish: true,
// 		});
// 		return oldDoc;
// 	}

// 	async getIndexById(streamId: string) {
// 		return TileDocument.load<any>(this.client!, streamId);
// 	}

// 	private setDates = (doc: Partial<Indexes>, update: boolean = false) => {
// 		const date = moment.utc().toISOString();
// 		if (update === false) {
// 			doc.createdAt = date;
// 		}
// 		doc.updatedAt = date;
// 	};
// }

// const ceramicService = new CeramicService();

// export default ceramicService;

export default {};
