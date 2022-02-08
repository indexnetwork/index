import Container from "layout/base/Grid/Container";
import SiteHeader from "layout/site/SiteHeader";
import React from "react";

const LandingLayout: React.FC = ({ children }) => (
	<>
		<SiteHeader headerType="user"/>
		<Container>
			{children}
		</Container>
	</>
);

export default LandingLayout;
