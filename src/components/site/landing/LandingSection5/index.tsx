import Button from "components/base/Button";
import Header from "components/base/Header";
import Flex from "layout/base/Grid/Flex";
import React from "react";
import LandingSection from "../LandingSection";
import cm from "./style.module.scss";

const LandingSection5: React.VFC = () => (
	<LandingSection dark>
		<Flex
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
		>
			<Header level={1} fontFamily="roquefort" className={cm.title}>For the people who favor context,
				by the people who like curation</Header>
			<Button>Create Your First Index</Button>
		</Flex>
	</LandingSection>
);

export default LandingSection5;
