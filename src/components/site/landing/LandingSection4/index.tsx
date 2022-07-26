import Header from "components/base/Header";
import Flex from "layout/base/Grid/Flex";
import React from "react";
import IconFeaturePublicPrivate from "components/base/Icon/IconFeaturePublicPrivate";
import IconFeatureCollab from "components/base/Icon/IconFeatureCollab";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";
import IconDescription from "../IconDescription";

const LandingSection4: React.VFC = () => (
	<LandingSection>
		<Flex
			alignItems="center"
			style={{
				position: "relative",
			}}
		>
			<Flex
				flex="1"
			>
				<img className={cm.img} alt="landing-4-img" src="/images/landing-4.png" />
			</Flex>
			<Flex flex="1" flexDirection="column">
				<Header className={cm.title}>Keep your indexes for yourself or share them with the world.</Header>
			</Flex>
		</Flex>
		<Flex
			flexGrow={1}
		>
			<IconDescription
				icon={<IconFeaturePublicPrivate />}
				title="Public & Private Profile"
				description="Keep it or share it. You can change your privacy settings of your indexes anytime."
			/>
			<IconDescription
				icon={<IconFeatureCollab />}
				title="Collaboration"
				description="Invite others to collaborate your indexes with e-mail or a link."
			/>
		</Flex>
	</LandingSection>
);

export default LandingSection4;
