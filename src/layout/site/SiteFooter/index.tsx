import IconTwitter from "components/base/Icon/IconTwitter";
import Footer, { FooterMenu } from "layout/base/Footer";
import React from "react";

const SiteFooter: React.FC = () => (
	<Footer
		innerFlexProps={{
			justifyContent: "space-between",
		}}
	>
		<FooterMenu>
			<a href="https://www.twitter.com" target="_blank" rel="noreferrer">
				<IconTwitter />
			</a>
		</FooterMenu>
	</Footer>
);

export default SiteFooter;
