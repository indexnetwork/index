import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconFeatureAddLink from "components/base/Icon/IconFeatureAddLink";
import IconFeatureExtension from "components/base/Icon/IconFeatureExtension";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";
import IconDescription from "../IconDescription";

const LandingSection2: React.VFC = () => (
	<LandingSection>
		<Flex
			style={{
				position: "relative",
			}}
			className="lnd-card"
		>
			<FlexRow className="pb-5">
				<Col xs={12} md={9}>
					<Header className="lnd-section-title">Create contextual discovery engines from your data</Header>
				</Col>
			</FlexRow>
			<FlexRow align={"center"}>
				<Col sm={12} lg={6} >
					<Flex flexDirection={"column"} className="lnd-features pr-lg-10 mr-lg-10">
						<div className={"mb-10"}>
							<IconDescription
								title={"For any kind of content"}
								icon={<IconFeatureAddLink fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
								description="Index products, articles, documents, NFTs, photos, videos, tweets and any other kind of content."
							/>
						</div>
						<IconDescription
							title={"From any source"}
							icon={<IconFeatureExtension fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
							description="Update your indexes directly from the apps you use or stay up-to-date with the indexes you follow."
							boldDescription="[soon]"
						/>
					</Flex>
				</Col>
				<Col sm={12} lg={6}>
					<img className={cm.img} alt="landing-2-img" src="/images/screen-index.png" />
				</Col>
			</FlexRow>
		</Flex>
	</LandingSection>
);

export default LandingSection2;
