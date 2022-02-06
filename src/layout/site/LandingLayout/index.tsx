import Container from "layout/base/Container";
import SiteHeader from "layout/site/SiteHeader";
import React from "react";

const LandingLayout: React.FC = ({ children }) => (
	<>
		<SiteHeader headerType="public"/>
		<Container>
			{children}
		</Container>
	</>
);

export default LandingLayout;
