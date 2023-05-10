import Button from "components/base/Button";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React, { useContext } from "react";
import { useAuth } from "hooks/useAuth";
import { useRouter } from "next/router";
import { AuthHandlerContext } from "components/site/context/AuthHandlerProvider";
import cm from "./style.module.scss";
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

	return <LandingSection>
		<Flex
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			className={cm.container}
		>
			<Header level={1} fontFamily="roquefort" className="lnd-7-title">Decentralization requires bundling</Header>
			<Button onClick={handleConnect} className="px-8" >Create Your First Index</Button>
		</Flex>
	</LandingSection>;
};

export default LandingSection7;
