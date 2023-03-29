import { ComposeClient } from "@composedb/client";
import {
	Indexes, IndexLink, Link, UserIndex, Users,
} from "types/entity";
import { getCurrentDateTime, isSSR, setDates } from "utils/helper";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import { RuntimeCompositeDefinition } from "@composedb/types";
import api, { GetUserIndexesRequestBody, UserIndexResponse } from "services/api-service";

import { definition } from "../types/merged-runtime";
import { appConfig } from "../config";

import LitService from "./lit-service";
import { decodeDIDWithLit } from "../utils/lit";

class CeramicService {
	private ipfs: IPFSHTTPClient = create({
		url: appConfig.ipfsInfura,
	});

	private userComposeClient = new ComposeClient({
		ceramic: "https://ceramic-dev.index.as",
		definition: definition as RuntimeCompositeDefinition,
	});
	private pkpComposeClient = new ComposeClient({
		ceramic: "https://ceramic-dev.index.as",
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

	async createIndex(content: Partial<Indexes>): Promise<Indexes> {
		const { pkpPublicKey } = await LitService.mintPkp();

		/*
			PKP public key is 0x0463b0f8584ceb4b3be313ccdb5356c1b8505420bbf9334446a1228d0b9e18e9f3f21cfcf5e107c2ac11041a02139abb0ff5165f1a71fde31287a95def85a4e19f
			Token ID is 0x5a0ed5d5fdf73b14b53ca25b3fa1996bbf5eb0e8004d436c3f55bd2013815645
			Token ID number is 40734368072587093465276453834418008413686098135730551600338205759635841963589
		*/

		const did = await LitService.authenticatePKP(appConfig.defaultCID, pkpPublicKey);
		/*
		if (!did.authenticated) {
			// TODO handle error
		}
		 */
		this.pkpComposeClient.setDID(did);

		setDates(content, true);
		if (!content.title) {
			content.title = "Untitled Index";
		}
		const cdt = getCurrentDateTime();
		content.created_at = cdt;
		content.updated_at = cdt;
		content.collab_action = appConfig.defaultCID;
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
		return data?.createIndex.document!;
	}
	async updateIndex(index: Partial<Indexes>, content: Partial<Indexes>): Promise<Indexes> {
		const pkpPublicKey = decodeDIDWithLit(index.controller_did?.id);

		const did = await LitService.authenticatePKP(index.collab_action!, pkpPublicKey);
		/*
		if (!did.authenticated) {
			// TODO handle error
		}
		 */
		this.pkpComposeClient.setDID(did);
		content.updated_at = getCurrentDateTime();
		const payload = {
			id: index.id,
			content,
		};
		const { data, errors } = await this.pkpComposeClient.executeQuery<{ updateIndex: { document: Indexes } }>(`
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
		return <Link>(result.data?.node as any);
	}

	async createLink(link: Partial<Link>): Promise<Link> {
		setDates(link); // TODO Conditional updated_at
		link.updated_at = getCurrentDateTime();
		if (!link.tags) {
			link.tags = [];
		}
		const payload = {
			content: link,
		};
		const { data, errors } = await this.userComposeClient.executeQuery<{ createLink: { document: Link } }>(`
			mutation CreateLink($input: CreateLinkInput!) {
				createLink(input: $input) {
					document {
						id
						controller_did{
							id
						}
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
	async updateLink(link_id: string, link: Link): Promise <Link> {
		// Get index link

		link.updated_at = getCurrentDateTime();
		const payload = {
			id: link_id,
			content: link,
		};
		const { data, errors } = await this.userComposeClient.executeQuery<{ updateLink: { document: Link } }>(`
			mutation UpdateLink($input: UpdateLinkInput!) {
				updateLink(input: $input) {
					document {
						id
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

	async addLinkToIndex(index: Indexes, link_id: string) : Promise <IndexLink> {
		const indexLink: IndexLink = {
			index_id: index.id,
			link_id,
			updated_at: getCurrentDateTime(),
			created_at: getCurrentDateTime(),
			indexer_did: this.userComposeClient.did?.id,
		};

		const payload = {
			content: indexLink,
		};

		const pkpPublicKey = decodeDIDWithLit(index.controller_did.id);
		const did = await LitService.authenticatePKP(index.collab_action, pkpPublicKey);

		if (!did.authenticated) {
			// handle error
		}

		this.pkpComposeClient.setDID(did);
		const { data, errors } = await this.pkpComposeClient.executeQuery<{ createIndexLink: { document: IndexLink } }>(`
			mutation CreateIndexLink($input: CreateIndexLinkInput!) {
				createIndexLink(input: $input) {
					document {
						id
						indexer_did {
							id
						}
						controller_did {
							id
						}
						created_at
						updated_at
						deleted_at
						link {
							id
							controller_did {
								id
							}
							title
							url
							favicon
							tags
							content
							created_at
							updated_at
							deleted_at
						}
					}
				}
			}`, { input: payload });

		if (errors) {
			// TODO Handle
		}
		return data?.createIndexLink.document!;
	}
	async removeLinkFromIndex(index: Indexes, link_id: string): Promise <IndexLink | undefined> {
		const pkpPublicKey = "0x0463b0f8584ceb4b3be313ccdb5356c1b8505420bbf9334446a1228d0b9e18e9f3f21cfcf5e107c2ac11041a02139abb0ff5165f1a71fde31287a95def85a4e19f";
		const did = await LitService.authenticatePKP("QmWXmYFnsMuBVhgEeJ2De4DLc47c6gPVSQBPqM7aLdGDNM", pkpPublicKey);
		/*
		if (!did.authenticated) {
			// TODO handle error
		}
		 */
		this.pkpComposeClient.setDID(did);

		const payload = {
			id: link_id!,
			content: {
				deleted_at: getCurrentDateTime(),
			},
		};
		const { data, errors } = await this.pkpComposeClient.executeQuery<{ updateIndexLink: { document: IndexLink } }>(`
			mutation UpdateIndexLink($input: UpdateIndexLinkInput!) {
				updateIndexLink(input: $input) {
					document {
						id
						index_id
						link_id
						created_at
						updated_at
						deleted_at				
					}
				}
			}`, { input: payload });

		if (errors) {
			// TODO Handle
		}

		return data?.updateIndexLink.document!;
	}
	async addTag(link_id: string, tag: string): Promise <Link | undefined> {
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
	async removeTag(link_id: string, tag: string): Promise <Link | undefined> {
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
						controller_did {
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
		console.log(payload);
		const { data, errors } = await this.userComposeClient.executeQuery<{ updateUserIndex: { document: UserIndex } }>(`
			mutation UpdateUserIndex($input: UpdateUserIndexInput!) {
				updateUserIndex(input: $input) {
					document {
						id
						index_id
						controller_did {
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
