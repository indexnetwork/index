import IconTwitter from "components/base/Icon/IconTwitter";
import Footer, { FooterMenu } from "components/layout/base/Footer";
import React from "react";

const SiteFooter: React.FC = () => (
	<Footer>
		<FooterMenu>
			<a href="https://www.twitter.com" target="_blank" rel="noreferrer">
				<IconTwitter />
			</a>
		</FooterMenu>
	</Footer>
);

export default SiteFooter;
