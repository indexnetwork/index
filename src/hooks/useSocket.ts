import { appConfig } from "config";
import {
	useEffect, useMemo, useRef, useState,
} from "react";
import socketIoClient, { Socket } from "socket.io-client";
import { LinkContentResult } from "types/entity";

export type ListenEvents = {
	deneme: (data: any) => void;
};

export interface UseSocketType {
	connected: boolean;
	synced?: LinkContentResult;
	io: Socket<ListenEvents, {}>;
}

export function useSocket(): UseSocketType {
	const io = useRef<Socket<ListenEvents, {}>>();

	const [connected, setConnected] = useState<boolean>(false);
	const [synced, setSynced] = useState<LinkContentResult>();

	const handlers: ListenEvents = useMemo(() => ({
		deneme: (data: any) => {
			setSynced(data);
		},
	}), []);

	const hostnameCheck = () : string => {
		if (typeof window !== "undefined") {
			if (window.location.hostname === "testnet.index.as" || window.location.hostname === "localhost") {
				return appConfig.baseUrl;
			}
			if (window.location.hostname === "dev.index.as") {
				return appConfig.devBaseUrl;
			}
		  }
		  return appConfig.baseUrl;
	};
	useEffect(() => {
		if (io.current && io.current.connected) {
			io.current.removeAllListeners();
			io.current.disconnect();
		}
		const token = localStorage.getItem("auth_token");
		const output: string = hostnameCheck();
		io.current = socketIoClient(output, {
			path: "/api/socket.io",
			extraHeaders: {
				Authorization: `Bearer ${token}`,
			},
		}) as Socket<ListenEvents, {}>;

			io.current!.on("connect", () => {
				setConnected(true);
			});

			io.current!.on("disconnect", () => {
				setConnected(false);
			});

			Object.keys(handlers).forEach((k) => {
				io.current!.on(k as keyof ListenEvents, handlers[k as keyof ListenEvents]);
			});

			return () => {
				if (io.current && io.current.connected) {
					io.current!.disconnect();
				}
			};
	}, []);

	return {
		connected,
		synced,
		io: io.current!,
	};
}
