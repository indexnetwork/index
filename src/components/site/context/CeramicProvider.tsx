import React, {
	useMemo, useState,
} from "react";
import ceramicService from "services/ceramic-service";
import { TileDocument } from "@ceramicnetwork/stream-tile";
import { Indexes, LinkContentResult, Links } from "types/entity";
import type { BasicProfile } from "@datamodels/identity-profile-basic";
import { CID } from "ipfs-http-client";

export type ListenEvents = {
	contentSync: (data: LinkContentResult) => void;
};

export interface CeramicContextValue {
	syncedData: any;
	createIndex(doc: Partial<Indexes>): Promise<Indexes | null>;
	updateIndex(index_id: string, content: Partial<Indexes>): Promise<Indexes>;
	getIndexById(streamId: string): Promise<Indexes>;
	getDocs(streams: { streamId: string }[]): Promise<{ [key: string]: TileDocument<Indexes> }>;
	getProfile(): Promise<BasicProfile | null>;
	setProfile(profile: BasicProfile): Promise<boolean>;
	uploadImage(file: File): Promise<{ cid: CID, path: string } | undefined>
	addLink(index_id: string, data: Links): Promise<Links>;
	removeLink(link_id: string): Promise<Links>;
	addTag(link_id: string, tag: string): Promise<Links>;
	removeTag(streamId: string, linkId: string, tag: string): Promise<Links>;
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

	const getDocs = (streams: { streamId: string }[]) => ceramicService.getIndexes(streams);

	const getProfile = async () => ceramicService.getProfile();

	const setProfile = async (profile: BasicProfile) => ceramicService.setProfile(profile);

	const uploadImage = async (file: File) => ceramicService.uploadImage(file);

	return (
		<CeramicContext.Provider value={{
			syncedData,
			createIndex,
			updateIndex,
			getIndexById,
			getDocs,
			addTag,
			addLink,
			getProfile,
			setProfile,
			removeLink,
			removeTag,
			uploadImage,
		}}>
			{children}
		</CeramicContext.Provider>
	);
};

export default CeramicProvider;
