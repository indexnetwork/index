import { TileDocument } from "@ceramicnetwork/stream-tile";
import { SelfID } from "@self.id/web";

import { CeramicClient } from "@ceramicnetwork/http-client";
import { ComposeClient } from "@composedb/client";

import { Indexes, LinkContentResult, Links } from "types/entity";
import { isSSR, setDates } from "utils/helper";
import type { BasicProfile } from "@datamodels/identity-profile-basic";
import { DID } from "dids";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import { appConfig } from "config";
import { RuntimeCompositeDefinition } from "@composedb/types";
import { definition } from "../types/merged-runtime";
import api from "./api-service";

class CeramicService2 {
	private ipfs: IPFSHTTPClient = create({
		url: appConfig.ipfsInfura,
	});
	/*
	private client = (isSSR() ? undefined : new WebClient({
		ceramic: this.hostnameCheck(),
		connectNetwork: appConfig.ceramicNetworkName as any,
	})) as WebClient;
	*/

	private ceramic = new CeramicClient("https://ceramic.index.as");
	private composeClient = new ComposeClient({
		ceramic: "https://ceramic.index.as",
		// cast our definition as a RuntimeCompositeDefinition
		definition: definition as RuntimeCompositeDefinition,
	});
	private self?: SelfID;

	async authenticate(did: any) {
		if (!isSSR()) {
			try {
				await this.ceramic.setDID(did);
				await this.composeClient.setDID(did);
				return true;
			} catch (err) {
				return false;
			}
		} else {
			return false;
		}
	}

	isAuthenticated() {
		return !!(this.ceramic?.did?.authenticated);
	}

	async getIndexById(streamId: string) {
		const result = await this.composeClient.executeQuery(`{
			node(id:"${streamId}"){
			  id
			  ... on Index{
				id
				title
				collab_action
				created_at
				updated_at
			}}
		  }`);
		return (
		<Indexes>(result.data?.node as any)
		);
	}
	async getLinksById(streamId: string) {
		const result = await this.composeClient.executeQuery(`{
			node(id:"${streamId}"){
			  id
			  ... on Index{
				title
				user_id
				created_at
			}}
		  }`);
		return <Links>(result.data?.node as any);
	}

	async getIndexes(streams: { streamId: string }[]): Promise<{ [key: string]: TileDocument<Indexes> }> {
		return await this.ceramic.multiQuery(streams) as any;
	}

	async createIndex(data: Partial<Indexes>): Promise<Indexes | null> {
		try {
			setDates(data);
			if (!data.title) {
				data.title = "Untitled Index";
			}
			const response = await this.composeClient.executeQuery(`
				mutation {
					createIndex(input: {
						content: {
							title: "${data.title}",
							collab_action: "example",
							created_at: "${data?.created_at}",
							updated_at: "${data?.updated_at}"
						}
					}) 
				{
					document {
						id
						title
						collab_action
						created_at
						updated_at
					}
				}
				}
			`);
			return response.data.createIndex.document as Links;
		} catch (err) {
			return null;
		}
	}

	async addLink(index_id: string, link: Links): Promise<[Links]> {
		setDates(link); // TODO Conditional updated_at

		try {
			const response = await this.composeClient.executeQuery(`
				mutation {
					createLink(input: {
						content: {
						  index_id: "${index_id}",
						  url: "${link.url}",
						  title: "${link.title}",
						  favicon: "${link.favicon}",
						  indexer_did: "did:key:z6Mkw8AsZ6ujciASAVRrfDu4UbFNTrhQJLV8Re9BKeZi8Tfx"
						  created_at: "${link.created_at}"
						  updated_at: "${link.created_at}"
						}
					}) {
					document {
						id
						index_id
						url
						title
						favicon
						indexer_did {
							id
						}
					}
				  }
				}
			`);
			return response.data.createLink.document as Links;
		} catch (err) {
			return null;
		}
		/*
		const oldDoc = await this.getIndexById(streamId);
		const { content } = oldDoc;
		const newLinks = prepareLinks(links);
		const newContent: Indexes = {
			...setDates(content, true),
			links: [...newLinks, ...content.links],
		};
		await oldDoc.update(newContent, undefined, {
			publish: true,
		});
		return [oldDoc, newLinks];
		 */
	}

	async putLinks(streamId: string, links: Links[]) {
		const oldDoc = await this.getIndexById(streamId);
		const { content } = oldDoc;
		const newContent: Indexes = {
			...content,
			links: links ?? [],
		};
		await oldDoc.update(newContent, undefined, {
			publish: true,
		});
		return oldDoc;
	}

	async addTag(streamId: string, linkId: string, tag: string) {
		const oldDoc = await this.getIndexById(streamId);
		const newContent = { ...oldDoc.content };
		const link = newContent.links?.find((l) => l.id === linkId);
		if (link) {
			const { tags } = link;
			if (tags && tags.includes(tag)) {
				return oldDoc;
			}
			link.tags = [...(tags ? [...tags, tag] : [tag])];
			await oldDoc.update(newContent, undefined, {
				publish: true,
			});
			return oldDoc;
		}
	}

	async removeTag(streamId: string, linkId: string, tag: string) {
		const oldDoc = await this.getIndexById(streamId);
		const newContent = { ...oldDoc.content };
		const link = newContent.links?.find((l) => l.id === linkId);
		if (link) {
			const { tags } = link;
			if (!tags) {
				return oldDoc;
			}
			link.tags = tags.filter((t) => t !== tag);
			await oldDoc.update(newContent, undefined, {
				publish: true,
			});
			return oldDoc;
		}
	}

	async setLinkFavorite(streamId: string, linkId: string, favorite: boolean) {
		const oldDoc = await this.getIndexById(streamId);
		const newContent = { ...oldDoc.content };
		const link = newContent.links?.find((l) => l.id === linkId);
		if (link) {
			link.favorite = favorite;
			await oldDoc.update(newContent, undefined, {
				publish: true,
			});
			return oldDoc;
		}
	}

	async removeLink(streamId: string, linkId: string) {
		const oldDoc = await this.getIndexById(streamId);
		const { content } = oldDoc;
		const newLinks = content?.links?.filter((li) => li.id !== linkId);
		await oldDoc.update({
			...content,
			links: newLinks,
		}, undefined, {
			publish: true,
		});
		return oldDoc;
	}

	async updateIndex(streamId: string, content: Partial<Indexes>) {
		setDates(content, true);

		const response = await this.composeClient.executeQuery(`
				mutation {
					updateIndex(input: {
						id: "${content.id}"
						content: {
							title: "${content.title}",
							collab_action: "example",
							updated_at: "${content?.updated_at}"
						}
					}) 
				{
					document {
						id
						title
						collab_action
						created_at
						updated_at
					}
				}
				}
			`);
		return response.data.createIndex.document as Links;
		await oldDoc.update({
			...oldDoc.content,
			...content,
		}, undefined, {
			publish: true,
		});
		return oldDoc;
	}

	async getProfile(): Promise<BasicProfile | null> {
		if (this.self) {
			return this.self?.get("basicProfile");
		}
		return null;
	}

	async setProfile(profile: BasicProfile) {
		if (this.self) {
			try {
				const streamId = await this.self.set("basicProfile", profile);
				return !!(streamId);
			} catch (err) {
				return false;
			}
		}
		return false;
	}

	async uploadImage(file: File) {
		if (this.self) {
			try {
				const { cid, path } = await this.ipfs.add(file);
				return { cid, path };
			} catch (err) {
				//
			}
		}
	}

	async syncContents(providedContent?: LinkContentResult): Promise<number | null> {
		try {
			const contents = providedContent ? [providedContent] : (await api.findLinkContent());

			if (contents && contents.length > 0) {
				const docs = await this.getIndexes(contents.map((c) => ({ streamId: c.streamId })));
				if (docs) {
					Object.keys(docs).forEach((sId) => {
						const newContent = contents.find((c) => c.streamId === sId);
						const tileDoc = docs[sId];
						if (newContent) {
							const { content } = tileDoc;
							if (content.links) {
								let contentChange = false;
								newContent.links?.forEach((l, i) => {
									const oldLink = content.links.find((nl) => nl.id === l.id!);
									if (oldLink) {
										content.links[i].content = l.content;
										contentChange = true;
									}
								});

								if (contentChange) {
									tileDoc.update(content, undefined, {
										publish: true,
									});
								}
							}
						}
					});
					const ids = contents.filter((x) => !!x.id).map((x) => x.id!);
					const syncResult = await api.completeSync(ids);
					return syncResult && syncResult.deletedCount;
				}
			}
			return null;
		} catch (err) {
			return null;
		}
	}

	async close() {
		if (this.isAuthenticated()) {
			this.ceramic.setDID(new DID());
			return this.ceramic.close();
		}
	}
}

const ceramicService2 = new CeramicService2();

export default ceramicService2;
