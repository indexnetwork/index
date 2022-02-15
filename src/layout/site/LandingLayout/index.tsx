import SiteNavbar from "layout/site/SiteNavbar";
import Head from "next/head";
import React from "react";
import SiteFooter from "../SiteFooter";

const LandingLayout: React.FC = ({ children }) => (
	<>
		<Head>
			<script async src="scripts/drag-drop-touch.js"></script>
		</Head>
		<SiteNavbar headerType="user" />
		{children}
		<SiteFooter />
	</>
);

export default LandingLayout;
