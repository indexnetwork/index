import React, {
	useMemo, useState,
} from "react";
import ceramicService from "services/ceramic-service";
import {
	Indexes, LinkContentResult, Links, Users, UserIndex
} from "types/entity";
import { CID } from "ipfs-http-client";

export type ListenEvents = {
	contentSync: (data: LinkContentResult) => void;
};

export interface CeramicContextValue {
	syncedData: any;
	createIndex(doc: Partial<Indexes>): Promise<Indexes | null>;
	updateIndex(index_id: string, content: Partial<Indexes>): Promise<Indexes>;
	getIndexById(streamId: string): Promise<Indexes>;
	addLink(index_id: string, data: Links): Promise<Links | undefined>;
	removeLink(link_id: string): Promise<Links | undefined>;
	addTag(link_id: string, tag: string): Promise<Links | undefined>;
	removeTag(link_id: string, tag: string): Promise<Links | undefined>;
	getProfile(): Promise<Users | null | any>;
	setProfile(profile: Users): Promise<Users | null | any>;
	uploadImage(file: File): Promise<{ cid: CID, path: string } | undefined>
	addUserIndex(index_id: string, type: string): Promise<UserIndex | undefined>;
	removeUserIndex(index_id: string, type: string): Promise<UserIndex | undefined>;

}

export const CeramicContext = React.createContext<CeramicContextValue>({} as any);

const CeramicProvider: React.FC<{}> = ({
	children,
}) => {
	const [syncedData, setSyncedData] = useState<LinkContentResult>();

	const handlers: ListenEvents = useMemo(() => ({
		contentSync: async (data) => {
			// await ceramicService.syncContents(data);
		},
	}), []);

	const createIndex = async (data: Partial<Indexes>) => {
		const doc = await ceramicService.createIndex(data);
		return doc;
	};

	const getIndexById = (streamId: string) => ceramicService.getIndexById(streamId);

	const updateIndex = async (index_id: string, content: Partial<Indexes>) => {
		const updatedDoc = await ceramicService.updateIndex(index_id, content);
		return updatedDoc;
	};

	const addLink = async (index_id: string, link: Links) => ceramicService.addLink(index_id, link);

	const removeLink = async (link_id: string) => {
		const updatedDoc = await ceramicService.removeLink(link_id);
		return updatedDoc;
	};

	const addTag = async (link_id: string, tag: string) => {
		const updatedDoc = await ceramicService.addTag(link_id, tag);
		return updatedDoc;
	};

	const removeTag = async (link_id: string, tag: string) => {
		const updatedDoc = await ceramicService.removeTag(link_id, tag);
		return updatedDoc;
	};

	const setLinkFavorite = async (streamId: string, linkId: string, favorite: boolean) => {
		const updatedDoc = await ceramicService.setLinkFavorite(streamId, linkId, favorite);
		return updatedDoc;
	};

	const getProfile = async () => ceramicService.getProfile();

	const setProfile = async (profile: Users) => ceramicService.setProfile(profile);

	const uploadImage = async (file: File) => ceramicService.uploadImage(file);

	const addUserIndex = async (index_id: string, type: string) => ceramicService.addUserIndex(index_id, type);
	const removeUserIndex = async (index_id: string, type: string) => ceramicService.removeUserIndex(index_id, type);

	return (
		<CeramicContext.Provider value={{
			syncedData,
			createIndex,
			updateIndex,
			getIndexById,
			addTag,
			addLink,
			getProfile,
			setProfile,
			removeLink,
			removeTag,
			uploadImage,
			addUserIndex,
			removeUserIndex,
		}}>
			{children}
		</CeramicContext.Provider>
	);
};

export default CeramicProvider;
