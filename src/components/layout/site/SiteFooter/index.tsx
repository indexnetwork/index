import IconDiscord from "components/base/Icon/IconDiscord";
import IconTelegram from "components/base/Icon/IconTelegram";
import IconTwitter from "components/base/Icon/IconTwitter";
import Footer, { FooterMenu } from "components/layout/base/Footer";
import React from "react";

const SiteFooter: React.FC = () => (
	<Footer>
		<FooterMenu className="mt-lg-8">
			<a href="https://discord.gg/gcB67c3U" target="_blank" rel="noreferrer">
				<IconDiscord fill="white" />
			</a>
			<a href="https://twitter.com/indexas" target="_blank" rel="noreferrer">
				<IconTwitter fill="white" />
			</a>
			<a href="https://twitter.com/indexas" target="_blank" rel="noreferrer">
				<IconTelegram fill="white" />
			</a>
		</FooterMenu>
	</Footer>
);

export default SiteFooter;
