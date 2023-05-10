import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconFeatureFilterTag from "components/base/Icon/IconFeatureFilterTag";
import IconFeatureSearch from "components/base/Icon/IconFeatureSearch";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";
import IconDescription from "../IconDescription";

const LandingSection3: React.VFC = () => (
	<LandingSection>
		<Flex
			alignItems="center"
			style={{
				position: "relative",
			}}
			className="lnd-card lnd-reorder"
		>
			<Flex flexDirection="column" className="lnd-title mb-lg-8 mb-xs-6">
				<Header className="lnd-section-title">If you index it, then search it.
Welcome to your refined discovery engine. Filter your indexes, and search as you type.</Header>
			</Flex>
			<Flex className="lnd-img">
				<img className={cm.img} alt="landing-3-img" src="/images/landing-3.webp" />
			</Flex>
			<Flex
				className="lnd-features"
			>
				<IconDescription
					icon={<IconFeatureFilterTag fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
					description="Filter your index by date, type, or any tag you want."
				/>
				<IconDescription
					icon={<IconFeatureSearch fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
					description="Your indexes are interoperable, with support of semantically described content types such as product, company, event, place, etc."
					boldDescription="Soon"
				/>
			</Flex>
		</Flex>
	</LandingSection>
);

export default LandingSection3;
