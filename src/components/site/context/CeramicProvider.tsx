import React, {
	useMemo, useState,
} from "react";
import ceramicService from "services/ceramic-service";
import {
	Indexes, LinkContentResult, Links, Users, UserIndex, IndexLink,
} from "types/entity";
import { CID } from "ipfs-http-client";
import api from "../../../services/api-service";

export type ListenEvents = {
	contentSync: (data: LinkContentResult) => void;
};

export interface CeramicContextValue {
	syncedData: any;
	createIndex(doc: Partial<Indexes>): Promise<Indexes | null>;
	updateIndex(index_id: string, content: Partial<Indexes>): Promise<Indexes>;
	getIndexById(index_id: string): Promise<Indexes | undefined>;

	createLink(data: Partial<Links>): Promise<Links | undefined>;
	updateLink(link_id: string, data: Links): Promise<Links | undefined>;
	addTag(link_id: string, tag: string): Promise<Links | undefined>;
	removeTag(link_id: string, tag: string): Promise<Links | undefined>;

	addLinkToIndex(index_id: string, link_id: string): Promise<IndexLink | undefined>;
	removeLinkFromIndex(index_id: string, link_id: string): Promise<IndexLink | undefined>;

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

	const getIndexById = (index_id: string) => api.getIndexById(index_id);

	const updateIndex = async (index_id: string, content: Partial<Indexes>) => {
		const updatedDoc = await ceramicService.updateIndex(index_id, content);
		return updatedDoc;
	};

	const createLink = async (link: Partial<Links>) => ceramicService.createLink(link);
	const updateLink = async (link_id: string, link: Links) => ceramicService.updateLink(link_id, link);

	const addLinkToIndex = async (index_id: string, link_id: string) => ceramicService.addLinkToIndex(index_id, link_id);
	const removeLinkFromIndex = async (index_id: string, link_id: string) => ceramicService.removeLinkFromIndex(index_id, link_id);

	const addTag = async (link_id: string, tag: string) => {
		const updatedDoc = await ceramicService.addTag(link_id, tag);
		return updatedDoc;
	};

	const removeTag = async (link_id: string, tag: string) => {
		const updatedDoc = await ceramicService.removeTag(link_id, tag);
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

			createLink,
			updateLink,
			addTag,
			removeTag,

			addLinkToIndex,
			removeLinkFromIndex,

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
