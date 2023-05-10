import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconFeatureAddLink from "components/base/Icon/IconFeatureAddLink";
import IconFeatureExtension from "components/base/Icon/IconFeatureExtension";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";
import IconDescription from "../IconDescription";

const LandingSection2: React.VFC = () => (
	<LandingSection>
		<Flex
			alignItems="center"
			style={{
				position: "relative",
			}}
			className="lnd-card lnd-reorder"
		>
			<Flex flexDirection="column" className="lnd-title mb-lg-8 mb-xs-6">
				<Header className="lnd-section-title">Create your indexes by adding any content you like and find relevant.</Header>
			</Flex>
			<Flex className="lnd-img">
				<img className={cm.img} alt="landing-2-img" src="/images/landing-2.webp" />
			</Flex>
			<Flex
				className="lnd-features"
			>
				<IconDescription
					icon={<IconFeatureAddLink fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
					description="Index products, articles, documents, NFTs, photos, videos, tweets and any other kind of content."
				/>
				<IconDescription
					icon={<IconFeatureExtension fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
					description="Index the web with a browser extension"
					boldDescription="Soon"
				/>
			</Flex>
		</Flex>
	</LandingSection>
);

export default LandingSection2;
