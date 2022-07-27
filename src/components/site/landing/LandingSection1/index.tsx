import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import Lottie from "react-lottie-player";
import cc from "classcat";
import Button from "components/base/Button";
import cm from "./style.module.scss";
import anim from "./anim.json";
import LandingSection from "../LandingSection";

const LandingSection1: React.VFC = () => (
	<LandingSection dark>
		<Flex
			alignItems="center"
		>
			<Flex flexDirection="column">
				<Header className={cm.blueTitle}>The human bridge between context and content.</Header>
				<Text className={cc([cm.descLine, cm.mbMd])}>Index.as helps you to curate content and<br />create searchable indexes.</Text>
				<Button>Create your first index</Button>
			</Flex>
			<Lottie
				loop
				animationData={anim}
				play
				style={{
					height: "100%",
					width: "100%",
				}}/>
		</Flex>
	</LandingSection>
);

export default LandingSection1;
