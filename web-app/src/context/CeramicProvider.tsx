// import React from "react";
// import CeramicService from "services/ceramic-service";
// import {
// 	Link, Users, UserIndex,
// } from "types/entity";

// import { DID } from "dids";

// export interface CeramicContextValue {
// 	authenticateUser(did: DID): void;
// 	isUserAuthenticated(): boolean;
// 	createLink(data: Partial<Link>): Promise<Link | undefined>;
// 	updateLink(link_id: string, data: Link): Promise<Link | undefined>;
// 	addTag(link_id: string, tag: string): Promise<Link | undefined>;
// 	removeTag(link_id: string, tag: string): Promise<Link | undefined>;

// 	getProfile(): Promise<Users | null | any>;
// 	getProfileByDID(did: string): Promise<Users | null | any>;
// 	setProfile(profile: Users): Promise<Users | null | any>;

// 	addUserIndex(index_id: string, type: string): Promise<UserIndex | undefined>;
// 	removeUserIndex(index_id: string, type: string): Promise<UserIndex | undefined>;

// }

// export const CeramicContext = React.createContext<CeramicContextValue>({} as any);

// export interface CeramicProviderProps {
// 	children: React.ReactNode;
// }
// const CeramicProvider = (
// 	{
// 		children,
// 	}: CeramicProviderProps,
// ) => {
// 	const clientRef = React.useRef<CeramicService>(new CeramicService());
// 	const authenticateUser = (did: DID) => {
// 		clientRef.current.authenticateUser(did);
// 	};
// 	const client = clientRef.current;
// 	const isUserAuthenticated = () => client.isUserAuthenticated();
// 	const createLink = async (link: Partial<Link>) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		return client.createLink(link);
// 	};
// 	const updateLink = async (link_id: string, link: Link) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		return client.updateLink(link_id, link);
// 	};
// 	const addTag = async (link_id: string, tag: string) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		const updatedDoc = await client.addTag(link_id, tag);
// 		return updatedDoc;
// 	};
// 	const removeTag = async (link_id: string, tag: string) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		const updatedDoc = await client.removeTag(link_id, tag);
// 		return updatedDoc;
// 	};
// 	const getProfile = async () => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		return client.getProfile();
// 	};
// 	const getProfileByDID = async (did: string) => client.getProfileByDID(did);
// 	const setProfile = async (profile: Users) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		return client.setProfile(profile);
// 	};

// 	const addUserIndex = async (index_id: string, type: string) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		return client.setUserIndex(index_id, type, true);
// 	};
  
// 	const removeUserIndex = async (index_id: string, type: string) => {
// 		if (!client.isUserAuthenticated()) {
// 			throw new Error("Invalid client");
// 		}
// 		return client.setUserIndex(index_id, type, false);
// 	};

// 	return (
// 		<CeramicContext.Provider value={{
// 			authenticateUser,
// 			isUserAuthenticated,
// 			createLink,
// 			updateLink,
// 			addTag,
// 			removeTag,
// 			getProfile,
// 			getProfileByDID,
// 			setProfile,
// 			addUserIndex,
// 			removeUserIndex,
// 		}}>
// 			{children}
// 		</CeramicContext.Provider>
// 	);
// };

// export default CeramicProvider;
