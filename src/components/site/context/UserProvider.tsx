import React, { useEffect, useState } from "react";

import { useAuth } from "hooks/useAuth";
import connectors from "connectors";

export interface UserContextValue {
	account?: string | null;
	token?: string | null;
	active: boolean;
	authenticated: boolean;
	loading: boolean;
	connect(provider: keyof typeof connectors): Promise<void>;
	disconnect(): void;
}

export const UserContext = React.createContext<UserContextValue>({} as any);

const UserProvider: React.FC<{}> = ({
	children,
}) => {
	const {
		account,
		connect,
		disconnect,
		connected,
		token,
		active,
		loading,
	} = useAuth();

	const [authenticated, setAuthenticated] = useState(false);

	useEffect(() => {
		setAuthenticated(!!(account && connected));
	}, [account, connected]);

	return (
		<UserContext.Provider value={{
			account,
			connect,
			disconnect,
			token,
			active,
			loading,
			authenticated,
		}}>
			{children}
		</UserContext.Provider>
	);
};

export default UserProvider;
