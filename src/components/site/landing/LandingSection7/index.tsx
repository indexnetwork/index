import Button from "components/base/Button";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React, { useContext } from "react";
import { useAuth } from "hooks/useAuth";
import { useRouter } from "next/router";
import { AuthHandlerContext } from "components/site/context/AuthHandlerProvider";
import LandingSection from "../LandingSection";

const LandingSection7 = () => {
	const router = useRouter();

	const authenticated = useAuth();

	const { connect, disconnect } = useContext(AuthHandlerContext);

	const handleConnect = async () => {
		try {
			await connect();
		} catch (err) {
			console.log(err);
		}
	};

	return <LandingSection noContainer >
		<Flex
			flexGrow={1}
			alignItems={"center"}
			flexDirection={"column"}
			className={"py-10 pt-10 mt-10"}
		>
			<Header fontFamily="roquefort" className="lnd-7-title">The human bridge between context and content.</Header>
			<Button onClick={handleConnect} className="px-8" >Create Your First Index</Button>
		</Flex>
	</LandingSection>;
};

export default LandingSection7;
