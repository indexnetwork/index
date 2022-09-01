import Button from "components/base/Button";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import LandingSection from "../LandingSection";
import cm from "./style.module.scss";

const LandingSection7: React.VFC = () => (
	<LandingSection>
		<Flex
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			className={cm.container}
		>
			<Header level={1} fontFamily="roquefort" className={cm.title}>Decentralization requires bundling</Header>
			<Button className="px-8">Create Your First Index</Button>
		</Flex>
	</LandingSection>
);

export default LandingSection7;
