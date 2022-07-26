import { useMergedState } from "hooks/useMergedState";
import React, {
	useContext, useEffect, useMemo, useRef, useState,
} from "react";
import ceramicService from "services/ceramic-service-2";

import { TileDocument } from "@ceramicnetwork/stream-tile";
import api from "services/api-service";
import { Indexes, LinkContentResult, Links } from "types/entity";
import type { BasicProfile } from "@datamodels/identity-profile-basic";
import socketIoClient, { Socket } from "socket.io-client";
import { UserContext } from "./UserProvider";

const API_URL = "http://localhost:3001";

export type ListenEvents = {
	contentSync: (data: LinkContentResult) => void;
};
export interface CeramicContextState {
}

export interface CeramicContextValue {
	authenticated: boolean;
	address?: string | null;
	socketConnected: boolean;
	syncedData: any;
	createDoc(doc: Partial<Indexes>): Promise<Indexes | null>;
	updateDoc(streamId: string, content: Partial<Indexes>): Promise<TileDocument<any>>;
	getDocById(streamId: string): Promise<TileDocument<Indexes>>;
	getDocs(streams: { streamId: string }[]): Promise<{ [key: string]: TileDocument<Indexes> }>;
	authenticate(): Promise<void>;
	getProfile(): Promise<BasicProfile | null>;
	setProfile(profile: BasicProfile): Promise<boolean>;
	addLink(streamId: string, data: Links): Promise<[TileDocument<Indexes>, Links[]]>;
	removeLink(streamId: string, linkId: string): Promise<TileDocument<Indexes>>;
	addTag(streamId: string, linkId: string, tag: string): Promise<TileDocument<Indexes> | undefined>;
	removeTag(streamId: string, linkId: string, tag: string): Promise<TileDocument<Indexes> | undefined>;
	setLinkFavorite(streamId: string, linkId: string, favorite: boolean): Promise<TileDocument<Indexes> | undefined>;
	putLinks(streamId: string, links: Links[]): Promise<TileDocument<Indexes>>;
	close(): Promise<void>;
}

export const CeramicContext = React.createContext<CeramicContextValue>({} as any);

const CeramicProvider: React.FC<{}> = ({
	children,
}) => {
	const {
		account,
		active,
	} = useContext(UserContext);
	const io = useRef<Socket<ListenEvents, {}>>();

	const [state, setState] = useMergedState<CeramicContextState>({});
	const [authenticated, setAuthenticated] = useState(false);
	const [syncedData, setSyncedData] = useState<LinkContentResult>();

	// Socket Variables
	const [socketConnected, setSocketConnected] = useState(false);
	const handlers: ListenEvents = useMemo(() => ({
		contentSync: async (data) => {
			console.log(data);
			await ceramicService.syncContents(data);
		},
	}), []);

	const createDoc = async (data: Partial<Indexes>) => {
		try {
			const doc = await ceramicService.createIndex(data);
			if (doc) {
				const result = await api.postIndex(doc);
				return result;
			}
			return null;
		} catch (err) {
			return null;
		}
	};

	const updateDoc = async (streamId: string, content: Partial<Indexes>) => {
		const updatedDoc = await ceramicService.updateIndex(streamId, content);
		return updatedDoc;
	};

	const addLink = async (streamId: string, link: Links) => ceramicService.addLink(streamId, [link]);

	const removeLink = async (streamId: string, linkId: string) => {
		const updatedDoc = await ceramicService.removeLink(streamId, linkId);
		return updatedDoc;
	};

	const addTag = async (streamId: string, linkId: string, tag: string) => {
		const updatedDoc = await ceramicService.addTag(streamId, linkId, tag);
		return updatedDoc;
	};

	const removeTag = async (streamId: string, linkId: string, tag: string) => {
		const updatedDoc = await ceramicService.removeTag(streamId, linkId, tag);
		return updatedDoc;
	};

	const setLinkFavorite = async (streamId: string, linkId: string, favorite: boolean) => {
		const updatedDoc = await ceramicService.setLinkFavorite(streamId, linkId, favorite);
		return updatedDoc;
	};

	const putLinks = async (streamId: string, links: Links[]) => {
		const updatedDoc = await ceramicService.putLinks(streamId, links);
		return updatedDoc;
	};

	const getDocById = (streamId: string) => ceramicService.getIndexById(streamId);

	const getDocs = (streams: { streamId: string }[]) => ceramicService.getIndexes(streams);

	const authenticate = async () => {
		if (!ceramicService.isAuthenticated() && account) {
			const result = await ceramicService.authenticate(account);
			setAuthenticated(result);
			await ceramicService.syncContents();
		} else if (!account) {
			try {
				await ceramicService.close();
			} finally {
				setAuthenticated(false);
			}
		}
	};

	const close = async () => {
		try {
			await ceramicService.close();
		} finally {
			setAuthenticated(false);
		}
	};

	const getProfile = async () => ceramicService.getProfile();

	const setProfile = async (profile: BasicProfile) => ceramicService.setProfile(profile);

	useEffect(() => {
		authenticate();
	}, [account, active]);

	useEffect(() => {
		if (authenticated) {
			if (io.current && io.current.connected) {
				io.current.removeAllListeners();
				io.current.disconnect();
			}

			const token = localStorage.getItem("auth_token");

			if (token) {
				io.current = socketIoClient(API_URL, {
					extraHeaders: {
						Authorization: `Bearer ${token}`,
					},
				}) as Socket<ListenEvents, {}>;

				io.current!.on("connect", () => {
					setSocketConnected(true);
				});

				io.current!.on("disconnect", () => {
					setSocketConnected(false);
				});

				io.current!.on("connect_error", (err) => {
					console.log(err);
				});

				Object.keys(handlers).forEach((k) => {
					io.current!.on(k as keyof ListenEvents, handlers[k as keyof ListenEvents]);
				});
			}
		} else if (io.current && io.current!.connected) {
			io.current!.removeAllListeners();
			io.current!.disconnect();
		}

		return () => {
			if (io.current && io.current.connected) {
				io.current!.disconnect();
			}
		};
	}, [authenticated]);

	return (
		<CeramicContext.Provider value={{
			authenticated,
			socketConnected,
			syncedData,
			address: account,
			createDoc,
			updateDoc,
			getDocById,
			getDocs,
			addTag,
			addLink,
			authenticate,
			getProfile,
			setProfile,
			putLinks,
			setLinkFavorite,
			removeLink,
			removeTag,
			close,
		}}>
			{children}
		</CeramicContext.Provider>
	);
};

export default CeramicProvider;
