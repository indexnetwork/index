import SiteHeader from "layout/site/SiteHeader";
import React from "react";
import SiteFooter from "../SiteFooter";

const LandingLayout: React.FC = ({ children }) => (
	<>
		<SiteHeader headerType="user" />
		{children}
		<SiteFooter />
	</>
);

export default LandingLayout;
