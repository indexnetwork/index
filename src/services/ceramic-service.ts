import moment from "moment";

import { SelfID } from "@self.id/web";

import { CeramicClient } from "@ceramicnetwork/http-client";
import { ComposeClient } from "@composedb/client";

import {
	Indexes, LinkContentResult, Links, UserIndex, Users,
} from "types/entity";
import { getCurrentDateTime, isSSR, setDates } from "utils/helper";
import type { BasicProfile } from "@datamodels/identity-profile-basic";
import { DID } from "dids";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import { RuntimeCompositeDefinition } from "@composedb/types";
import { definition } from "../types/merged-runtime";

class CeramicService2 {
	private ipfs: IPFSHTTPClient = create({
		// url: appConfig.ipfsInfura,
	});

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
				console.log(did);
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
				links(last:1) {
					edges {
					  node {
						created_at
						updated_at
					  }
					}
				}
			}}
		  }`);

		const node: any = result?.data?.node;

		if (node.links.edges.length > 0 && (moment(node.links.edges[0].node.updated_at) > moment(node.updated_at))) {
			node.updated_at = node.links.edges[0].node.updated_at;
		}

		return (
		<Indexes>(node as any)
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

	async createIndex(content: Partial<Indexes>): Promise<Indexes> {
		setDates(content, true);
		if (!content.title) {
			content.title = "Untitled Index";
		}
		const cdt = getCurrentDateTime();
		content.created_at = cdt;
		content.updated_at = cdt;
		content.collab_action = "QmYNtw5mTnjvMZWZRe8nvubs9XVYUUaSJPEYKyKQG4BQQ8";
		const payload = {
			content,
		};
		const { data, errors } = await this.composeClient.executeQuery<{ createIndex: { document: Indexes } }>(`
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

		if (errors) {
			// TODO Handle
		}
		const index = data?.createIndex.document;
		await this.addMyIndexes(index!.id);
		return index!;
	}

	async updateIndex(index_id: string, content: Partial<Indexes>): Promise<Indexes> {
		const cdt = getCurrentDateTime();
		content.updated_at = cdt;
		const payload = {
			id: index_id,
			content,
		};
		const { data, errors } = await this.composeClient.executeQuery<{ updateIndex: { document: Indexes } }>(`
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

		if (errors) {
			// TODO Handle
		}
		return data?.updateIndex.document!;
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
		const { data, errors } = await this.composeClient.executeQuery<{ createLink: { document: Links } }>(`
			mutation CreateLink($input: CreateLinkInput!) {
				createLink(input: $input) {
					document {
						id
						index_id
						url
						title
						tags
						favicon
						created_at
						updated_at
					}
				}
			}`, { input: payload });
		if (errors) {
			// TODO Handle
		}
		return data?.createLink.document!;
	}

	async updateLink(link_id: string, link: Partial<Links>): Promise <Links> {
		link.updated_at = getCurrentDateTime();
		const payload = {
			id: link_id,
			content: link,
		};
		const { data, errors } = await this.composeClient.executeQuery<{ updateLink: { document: Links } }>(`
			mutation UpdateLink($input: UpdateLinkInput!) {
				updateLink(input: $input) {
					document {
						id
						index_id
						url
						title
						tags
						favicon
						created_at
						updated_at						
					}
				}
			}`, { input: payload });
		if (errors) {
			// TODO Handle
		}
		return data?.updateLink.document!;
	}

	async removeLink(link_id: string): Promise <Links | undefined> {
		const link = await this.getLinkById(link_id);
		if (link) {
			return await this.updateLink(link_id, {
				deleted_at: getCurrentDateTime(), // TODO fix deleted_at
			} as Links);
		}
		// TODO handle
	}

	async addTag(link_id: string, tag: string): Promise <Links | undefined> {
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

	async removeTag(link_id: string, tag: string): Promise <Links | undefined> {
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
		// TODO handle.
	}

	async setLinkFavorite(streamId: string, linkId: string, favorite: boolean) {
		/*
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

		 */
	}

	async addMyIndexes(index_id: string): Promise<UserIndex> {
		const userIndex = {
			index_id,
			created_at: getCurrentDateTime(),
		};
		const payload = {
			content: userIndex,
		};
		const { data, errors } = await this.composeClient.executeQuery<{ createUserIndex: { document: UserIndex } }>(`
			mutation CreateUserIndex($input: CreateUserIndexInput!) {
				createUserIndex(input: $input) {
					document {
						id
						index_id
						owner {
							id
						}
						created_at
						deleted_at
					}
				}
			}`, { input: payload });
		if (errors) {
			// TODO Handle
		}
		return data?.createUserIndex.document!;
	}

	async removeMyIndexes(index_id: string) {
		/*
		link.updated_at = getCurrentDateTime();
		const payload = {
			id: link_id,
			content: link,
		};
		const response = await this.composeClient.executeQuery<{ createUserIndex: { document: UserIndex } }>(`
			mutation UpdateLink($input: UpdateLinkInput!) {
				updateUserIndex(input: $input) {
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

		 */
	}

	async getProfile(): Promise<Users> {
		const { data, errors } = await this.composeClient.executeQuery<{ viewer: { indexasProfile: Users } }>(`
			query {
				viewer {
					indexasProfile {
						id
						name
						pfp
					}
				}
			}
		`);
		if (errors) {
			// TODO Handle
		}
		return <Users>data?.viewer?.indexasProfile!;
	}
	async setProfile(profile: BasicProfile) {
		const update = await this.composeClient.executeQuery(`
        mutation {
          createBasicProfile(input: {
            content: {
              name: "ab"
              description: "ab"
            }
          }) 
          {
            document {
              name
              description
              gender
              emoji
            }
          }
        }
      `);

		return true;
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

	// @ts-ignore
	async syncContents(providedContent?: LinkContentResult): Promise<number | null> {
		/*
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

		 */
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
