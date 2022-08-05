import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconFeatureFilterTag from "components/base/Icon/IconFeatureFilterTag";
import IconFeatureSearch from "components/base/Icon/IconFeatureSearch";
import LazyLoad from "react-lazyload";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";
import IconDescription from "../IconDescription";

const LandingSection3: React.VFC = () => (
	<LandingSection dark>
		<Flex
			alignItems="center"
			style={{
				position: "relative",
			}}
			className="idx-lnd-card"
		>
			<Flex flex="1" flexDirection="column" className="idx-lnd-desc">
				<Header className={cm.title}>If you index it, then search it.
				 Welcome to your refined search engine. Filter your indexes, and search as you type.</Header>
			</Flex>
			<Flex
				flex="1"
				className="idx-lnd-img idx-lnd-img-reverse"
			>
				<LazyLoad once>
					<img className={cm.img} alt="landing-3-img" src="/images/landing-3.png" />
				</LazyLoad>
			</Flex>
		</Flex>
		<Flex
			flexGrow={1}
			className="idx-lnd-features"
		>
			<IconDescription
				icon={<IconFeatureFilterTag className="idx-lnd-icon-desc-icon" />}
				title="Filter & Tags"
				description="Filter your index through date, kind, or any tag you would add."
			/>
			<IconDescription
				icon={<IconFeatureSearch className="idx-lnd-icon-desc-icon" />}
				title="Search"
				description="Turn your indexes into refined search engine."
			/>
		</Flex>
	</LandingSection>
);

export default LandingSection3;
