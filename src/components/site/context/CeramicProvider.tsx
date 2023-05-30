import React, { useState } from "react";
import CeramicService from "services/ceramic-service";
import {
	Indexes, Link, Users, UserIndex, IndexLink,
} from "types/entity";
import { CID } from "ipfs-http-client";

export interface CeramicContextValue {
	setClient: React.Dispatch<React.SetStateAction<CeramicService>>;
	client: CeramicService;
	createLink(data: Partial<Link>): Promise<Link | undefined>;
	updateLink(link_id: string, data: Link): Promise<Link | undefined>;
	addTag(link_id: string, tag: string): Promise<Link | undefined>;
	removeTag(link_id: string, tag: string): Promise<Link | undefined>;

	getProfile(): Promise<Users | null | any>;
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

	const [client, setClient] = useState<any>();

	const createLink = async (link: Partial<Link>) => client.createLink(link);
	const updateLink = async (link_id: string, link: Link) => client.updateLink(link_id, link);
	const addTag = async (link_id: string, tag: string) => {
		const updatedDoc = await client.addTag(link_id, tag);
		return updatedDoc;
	};

	const removeTag = async (link_id: string, tag: string) => {
		const updatedDoc = await client.removeTag(link_id, tag);
		return updatedDoc;
	};

	const getProfile = async () => client.getProfile();

	const setProfile = async (profile: Users) => client.setProfile(profile);

	const uploadImage = async (file: File) => client.uploadImage(file);

	const addUserIndex = async (index_id: string, type: string) => client.addUserIndex(index_id, type);
	const removeUserIndex = async (index_id: string, type: string) => client.removeUserIndex(index_id, type);

	return (
		<CeramicContext.Provider value={{
			setClient,
			client,
			createLink,
			updateLink,
			addTag,
			removeTag,
			getProfile,
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
