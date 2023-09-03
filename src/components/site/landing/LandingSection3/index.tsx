import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconFeatureAddLink from "components/base/Icon/IconFeatureAddLink";
import IconFeatureExtension from "components/base/Icon/IconFeatureExtension";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";
import IconDescription from "../IconDescription";
import FlexRow from "../../../layout/base/Grid/FlexRow";
import Col from "../../../layout/base/Grid/Col";

const LandingSection3: React.VFC = () => (
	<LandingSection>
		<Flex
			style={{
				position: "relative",
			}}
			className="lnd-card"
		>
			<FlexRow className="pb-5">
				<Col xs={12} md={9}>
					<Header className="lnd-section-title">Collaborate on two-person projects up to DAO-scale. Monetize independently.</Header>
				</Col>
			</FlexRow>
			<FlexRow align={"center"}>
				<Col sm={12} lg={6} >
					<Flex flexDirection={"column"} className="lnd-features pr-lg-10 mr-lg-10">
						<div className={"mb-10"}>
							<IconDescription
								title={"Multiplayer Indexes"}
								icon={<IconFeatureAddLink fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
								description='Specify on-chain criteria like "user must hold an NFT" and the network will provide permission to those who meet those criteria.'
							/>
						</div>
						<div>
							<IconDescription
								title={"Creator Monetization"}
								icon={<IconFeatureExtension fill="var(--gray-5)" className="lnd-icon-desc-icon" />}
								description="Monetize indexes with your own terms by composing access control conditions"
								boldDescription="[soon]"
							/>
						</div>
					</Flex>
				</Col>
				<Col sm={12} lg={6}>
					<img className={cm.img} alt="landing-2-img" src="/images/screen-multiplayer.png" />
				</Col>
			</FlexRow>
		</Flex>
	</LandingSection>
);

export default LandingSection3;
