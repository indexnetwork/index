import IconDiscord from "components/base/Icon/IconDiscord";
import IconTwitter from "components/base/Icon/IconTwitter";
import Footer, { FooterMenu } from "components/layout/base/Footer";
import React from "react";
import LogoFull from "components/base/Logo/LogoFull";

const SiteFooter = () => (
	<Footer>
		<FooterMenu className="mt-lg-8">
			<a href="https://discord.gg/G7UYCXfR9p" target="_blank" rel="noreferrer">
				<IconDiscord fill="white" />
			</a>
			<a href="https://twitter.com/indexas" target="_blank" rel="noreferrer">
				<IconTwitter fill="white" />
			</a>
			{/* <a href="https://telegram.com/indexas" target="_blank" rel="noreferrer">
				<IconTelegram fill="white" />
			</a> */}
			<LogoFull className="footer-logo"></LogoFull>
		</FooterMenu>
	</Footer>
);

export default SiteFooter;
