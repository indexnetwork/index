import { useRouter } from "next/router";
import React, { ReactElement, useContext } from "react";
import { UserContext } from "../context/UserProvider";

const AuthGuard: React.FC<{
	children: ReactElement,
}> = (props) => {
	const { loading, account, active } = useContext(UserContext);
	const router = useRouter();

	if (loading) {
		return <div>Loading</div>;
	}
	if (!loading && account && active) {
		return props.children!;
	}
	router.push("/");
	return null;
};

export default AuthGuard;
