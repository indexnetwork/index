import SiteNavbar from "layout/site/SiteNavbar";
import React from "react";
import SiteFooter from "../SiteFooter";

const LandingLayout: React.FC = ({ children }) => (
	<>
		<SiteNavbar headerType="user" />
		{children}
		<SiteFooter />
	</>
);

export default LandingLayout;
