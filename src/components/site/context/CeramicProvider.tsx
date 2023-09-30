import React, { useState } from "react";
import CeramicService from "services/ceramic-service";
import {
	Link, Users, UserIndex,
} from "types/entity";

import { CID } from "multiformats";

export interface CeramicContextValue {
	setClient: React.Dispatch<React.SetStateAction<CeramicService | undefined>>;
	client: CeramicService | undefined;
	createLink(data: Partial<Link>): Promise<Link | undefined>;
	updateLink(link_id: string, data: Link): Promise<Link | undefined>;
	addTag(link_id: string, tag: string): Promise<Link | undefined>;
	removeTag(link_id: string, tag: string): Promise<Link | undefined>;

	getProfile(): Promise<Users | null | any>;
	getProfileByDID(did: string): Promise<Users | null | any>;
	setProfile(profile: Users): Promise<Users | null | any>;

	uploadImage(file: File): Promise<{ cid: CID, path: string } | undefined>

	addUserIndex(index_id: string, type: string): Promise<UserIndex | undefined>;
	removeUserIndex(index_id: string, type: string): Promise<UserIndex | undefined>;

}

export const CeramicContext = React.createContext<CeramicContextValue>({} as any);

export interface CeramicProviderProps {
	children: React.ReactNode;
}
const CeramicProvider = (
	{
		children,
	}: CeramicProviderProps,
) => {
	const [client, setClient] = useState<CeramicService | undefined>();

	const createLink = async (link: Partial<Link>) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.createLink(link);
	};
	const updateLink = async (link_id: string, link: Link) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.updateLink(link_id, link);
	};
	const addTag = async (link_id: string, tag: string) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		const updatedDoc = await client.addTag(link_id, tag);
		return updatedDoc;
	};
	const removeTag = async (link_id: string, tag: string) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		const updatedDoc = await client.removeTag(link_id, tag);
		return updatedDoc;
	};
	const getProfile = async () => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.getProfile();
	};
	const getProfileByDID = async (did: string) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.getProfileByDID(did);
	};
	const setProfile = async (profile: Users) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.setProfile(profile);
	};
	const uploadImage = async (file: File) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.uploadImage(file);
	};
	const addUserIndex = async (index_id: string, type: string) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.setUserIndex(index_id, type, true);
	};
	const removeUserIndex = async (index_id: string, type: string) => {
		if (!client) {
			throw new Error("Invalid client");
		}
		return client.setUserIndex(index_id, type, false);
	};

	return (
		<CeramicContext.Provider value={{
			setClient,
			client,
			createLink,
			updateLink,
			addTag,
			removeTag,
			getProfile,
			getProfileByDID,
			setProfile,
			uploadImage,
			addUserIndex,
			removeUserIndex,
		}}>
			{children}
		</CeramicContext.Provider>
	);
};

export default CeramicProvider;
