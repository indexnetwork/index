import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconFeatureAddLink from "components/base/Icon/IconFeatureAddLink";
import IconFeatureExtension from "components/base/Icon/IconFeatureExtension";
import LazyLoad from "react-lazyload";
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
			className="idx-lnd-card"
		>
			<Flex flex="1" className="idx-lnd-img">
				<LazyLoad once>
					<img className={cm.img} alt="landing-2-img" src="/images/landing-2.png" />
				</LazyLoad>
			</Flex>
			<Flex flex="1" flexDirection="column" className="idx-lnd-desc">
				<Header className={cm.title}>Create your indexes by adding any content you like and find relevant.
					Index how you see, read, and understand the world.</Header>
			</Flex>
		</Flex>
		<Flex
			flexGrow={1}
			className="idx-lnd-features"
		>
			<IconDescription
				icon={<IconFeatureAddLink className="idx-lnd-icon-desc-icon" />}
				title="Add link"
				description="Add the link of the content to your index. Copy, paste, done."
			/>
			<IconDescription
				icon={<IconFeatureExtension className="idx-lnd-icon-desc-icon" />}
				title="Extension"
				description="Add links to your index while you browse the web"
			/>
		</Flex>
	</LandingSection>
);

export default LandingSection2;
