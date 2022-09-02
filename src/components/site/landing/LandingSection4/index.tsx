import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
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
			className="lnd-card lnd-reorder"
		>
			<Flex flexDirection="column" className="lnd-title mb-lg-8 mb-xs-6">
				<Header className="lnd-section-title">Collaborate on two-person projects up to DAO-scale. Monetize independently.</Header>
			</Flex>
			<Flex className="lnd-img">
				<img className={cm.img} alt="landing-4-img" src="/images/landing-4.webp" />
			</Flex>
			<Flex
				className="lnd-features"
			>
				<IconDescription
					icon={<IconFeaturePublicPrivate fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
					description='Specify on-chain criteria like "user must hold an NFT" and the network will provide permission to those who meet those criteria.'
				/>
				<IconDescription
					icon={<IconFeatureCollab fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
					description="Monetize your index with your own terms by composing access control conditions."
				/>
			</Flex>
		</Flex>
	</LandingSection>
);

export default LandingSection4;
