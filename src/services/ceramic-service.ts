import moment from "moment";
import { ComposeClient } from "@composedb/client";
import {
	Indexes, Links, UserIndex, Users,
} from "types/entity";
import { getCurrentDateTime, isSSR, setDates } from "utils/helper";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import { RuntimeCompositeDefinition } from "@composedb/types";
import api, { GetUserIndexesRequestBody, UserIndexResponse } from "services/api-service";

import { definition } from "../types/merged-runtime";
import { appConfig } from "../config";

import LitService from "./lit-service";

class CeramicService {
	private ipfs: IPFSHTTPClient = create({
		url: appConfig.ipfsInfura,
	});
	private userComposeClient = new ComposeClient({
		ceramic: "https://ceramic.index.as",
		definition: definition as RuntimeCompositeDefinition,
	});
	private pkpComposeClient = new ComposeClient({
		ceramic: "https://ceramic.index.as",
		definition: definition as RuntimeCompositeDefinition,
	});

	async authenticateUser(did: any) {
		if (!isSSR()) {
			try {
				await this.userComposeClient.setDID(did);
				return true;
			} catch (err) {
				return false;
			}
		} else {
			return false;
		}
	}

	isUserAuthenticated() {
		return !!(this.userComposeClient?.did?.authenticated);
	}

	async getIndexById(index_id: string) {
		const result = await this.userComposeClient.executeQuery(`{
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

		if (this.isUserAuthenticated()) {
			const userIndexes = await api.getUserIndexes({
				index_id,
				did: this.userComposeClient.did?.parent!,
			} as GetUserIndexesRequestBody) as UserIndexResponse;
			node.is_in_my_indexes = !!userIndexes.my_indexes;
			node.is_starred = !!userIndexes.starred;
		}

		return (
		<Indexes>(node as any)
		);
	}
	async getLinkById(link_id: string) {
		const result = await this.userComposeClient.executeQuery(`{
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

		// const { pkpPublicKey } = await LitService.mintPkp();
		/*
		0x04d23b0bce7a73dc69684cc0c7d00856bff050c408a0755c629f7067143fb5acaf5055361301c06ba329746d9e53fb3ed28de127137174bdf23d9b19f0062dca1a
		and Token ID is 0x61147fdf0f5bd1a926a94b3bc4d97526c46d7127f593003cdf6db2b2ff65350d
		43910565789344013050534618981627019256365100662200283369978725539582069519629
		*/
		const pkpPublicKey = "0x04d23b0bce7a73dc69684cc0c7d00856bff050c408a0755c629f7067143fb5acaf5055361301c06ba329746d9e53fb3ed28de127137174bdf23d9b19f0062dca1a";
		const did = await LitService.authenticatePKP("QmWXmYFnsMuBVhgEeJ2De4DLc47c6gPVSQBPqM7aLdGDNM", pkpPublicKey);
		if (!did) {
			// TODO handle error
		}
		this.pkpComposeClient.setDID(did);
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
		const { data, errors } = await this.pkpComposeClient.executeQuery<{ createIndex: { document: Indexes } }>(`
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
		// await this.addUserIndex(index!.id, "my_indexes");
		return index!;
	}

	async updateIndex(index_id: string, content: Partial<Indexes>): Promise<Indexes> {
		const cdt = getCurrentDateTime();
		content.updated_at = cdt;
		const payload = {
			id: index_id,
			content,
		};
		const { data, errors } = await this.userComposeClient.executeQuery<{ updateIndex: { document: Indexes } }>(`
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
		const { data, errors } = await this.userComposeClient.executeQuery<{ createLink: { document: Links } }>(`
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
		const { data, errors } = await this.userComposeClient.executeQuery<{ updateLink: { document: Links } }>(`
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

	async addUserIndex(index_id: string, type: string): Promise<UserIndex | undefined> {
		const userIndex = {
			index_id,
			created_at: getCurrentDateTime(),
			type,
		};
		console.log("add", userIndex);
		const payload = {
			content: userIndex,
		};
		const { data, errors } = await this.userComposeClient.executeQuery<{ createUserIndex: { document: UserIndex } }>(`
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

	async removeUserIndex(index_id: string, type: string): Promise<UserIndex | undefined> {
		console.log("remove", index_id, this.userComposeClient.did?.parent!, type);
		const userIndexes = await api.getUserIndexes({
			index_id,
			did: this.userComposeClient.did?.parent!,
		} as GetUserIndexesRequestBody) as UserIndexResponse;
		type UserIndexKey = keyof typeof userIndexes;

		if (!userIndexes[type as UserIndexKey]) {
			return;
		}
		const userIndex: UserIndex | undefined = userIndexes[type as UserIndexKey];
		const payload = {
			id: userIndex?.id!,
			content: {
				deleted_at: getCurrentDateTime(),
			},
		};
		const { data, errors } = await this.userComposeClient.executeQuery<{ updateUserIndex: { document: UserIndex } }>(`
			mutation UpdateUserIndex($input: UpdateUserIndexInput!) {
				updateUserIndex(input: $input) {
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
		return data?.updateUserIndex.document!;
	}

	async getProfile(): Promise<Users> {
		const { data, errors } = await this.userComposeClient.executeQuery<{ viewer: { indexasProfile: Users } }>(`
			query {
				viewer {
					indexasProfile {
						name
						description
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
	async setProfile(profile: Users) {
		if (!profile.pfp) {
			delete profile.pfp;
		}
		const payload = {
			content: profile,
		};
		const { data, errors } = await this.userComposeClient.executeQuery<{ createIndexasProfile: { document: Users } }>(`	
			mutation CreateIndexasProfile($input: CreateIndexasProfileInput!) {
				createIndexasProfile(input: $input) {
					document {
					  name
					  description
					  pfp					
					}
				}
			}`, { input: payload });
		if (errors) {
			// TODO Handle
		}
		return data?.createIndexasProfile.document!;
	}

	async uploadImage(file: File) {
		try {
			const { cid, path } = await this.ipfs.add(file);
			return { cid, path };
		} catch (err) {
			//
		}
	}
}

const ceramicService = new CeramicService();

export default ceramicService;
