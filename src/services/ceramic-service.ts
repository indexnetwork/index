import { TileDocument } from "@ceramicnetwork/stream-tile";
import { SelfID } from "@self.id/web";

import { CeramicClient } from "@ceramicnetwork/http-client";
import { ComposeClient } from "@composedb/client";

import { Indexes, LinkContentResult, Links } from "types/entity";
import { getCurrentDateTime, isSSR, setDates } from "utils/helper";
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

	async getIndexById(index_id: string) {
		const result = await this.composeClient.executeQuery(`{
			node(id:"${index_id}"){
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
	async getLinkById(link_id: string) {
		const result = await this.composeClient.executeQuery(`{
			node(id:"${link_id}"){
			  id
			  ... on Link{
				id
				content
				title
				url
				favicon
				created_at
				updated_at
				tags
			}}
		  }`);
		return <Links>(result.data?.node as any);
	}

	async getIndexes(streams: { streamId: string }[]): Promise<{ [key: string]: TileDocument<Indexes> }> {
		return await this.ceramic.multiQuery(streams) as any;
	}

	async createIndex(content: Partial<Indexes>): Promise<Indexes> {
		setDates(content, true);
		if (!content.title) {
			content.title = "Untitled Index";
		}
		const cdt = getCurrentDateTime();
		content.created_at = cdt;
		content.updated_at = cdt;
		const payload = {
			content,
		};
		const response = await this.composeClient.executeQuery(`
			mutation CreateIndex($input: CreateIndexInput!) {
				createIndex(input: $input) {
					document {
						id
						title
						collab_action
						created_at
						updated_at
					}
				}
			}`, { input: payload });
		return response.data.createIndex.document as Indexes;
	}

	async updateIndex(index_id: string, content: Partial<Indexes>): Promise<Indexes> {
		const cdt = getCurrentDateTime();
		content.updated_at = cdt;
		const payload = {
			id: index_id,
			content,
		};
		const response = await this.composeClient.executeQuery(`
			mutation UpdateIndex($input: UpdateIndexInput!) {
				updateIndex(input: $input) {
					document {
						id
						title
						collab_action
						created_at
						updated_at
					}
				}
			}`, { input: payload });
		return response.data.updateIndex.document as Indexes;
	}

	async addLink(index_id: string, link: Links): Promise<Links> {
		setDates(link); // TODO Conditional updated_at

		link.index_id = index_id;
		link.indexer_did = "did:key:z6Mkw8AsZ6ujciASAVRrfDu4UbFNTrhQJLV8Re9BKeZi8Tfx";
		link.updated_at = getCurrentDateTime();
		if (!link.tags) {
			link.tags = [];
		}
		const payload = {
			content: link,
		};
		const response = await this.composeClient.executeQuery(`
			mutation CreateLink($input: CreateLinkInput!) {
				createLink(input: $input) {
					document {
						id
						index_id
						url
						title
						tags
						favicon
					}
				}
			}`, { input: payload });
		return response.data.createLink.document as Links;
	}

	async updateLink(link_id: string, link: Partial<Links>): Promise <Links> {
		link.updated_at = getCurrentDateTime();
		const payload = {
			id: link_id,
			content: link,
		};
		const response = await this.composeClient.executeQuery(`
			mutation UpdateLink($input: UpdateLinkInput!) {
				updateLink(input: $input) {
					document {
						id
						index_id
						url
						title
						tags
						favicon
					}
				}
			}`, { input: payload });
		return response.data.updateLink.document as Links;
	}

	async removeLink(link_id: string): Promise <Links> {
		const link = await this.getLinkById(link_id);
		if (link) {
			return await this.updateLink(link_id, {
				deleted_at: getCurrentDateTime(),
			} as Links);
		}
		// TODO handle
	}

	async addTag(link_id: string, tag: string): Promise <Links> {
		const link = await this.getLinkById(link_id);
		if (link) {
			let { tags } = link;
			if (tags && tags.includes(tag)) {
				return link;
			}
			tags = [...(tags ? [...tags, tag] : [tag])];
			return await this.updateLink(link_id, {
				tags,
			});
		}
		// TODO handle.
	}

	async removeTag(link_id: string, tag: string): Promise <Links> {
		const link = await this.getLinkById(link_id);
		if (link) {
			let { tags } = link;
			if (!tags) {
				return link;
			}
			tags = tags.filter((t) => t !== tag);
			return await this.updateLink(link_id, {
				tags,
			});
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
