import SiteNavbar from "components/layout/site/SiteNavbar";
import Head from "next/head";
import React from "react";
import SiteFooter from "../SiteFooter";

export interface LandingLayoutProps {
	children: React.ReactNode;
}

const LandingLayout = ({
	children,
}: LandingLayoutProps) => (
	<>
		<Head>
			<script async src="scripts/drag-drop-touch.js"></script>
		</Head>
		<SiteNavbar isLanding={true} headerType="public" />
		{children}
		<SiteFooter />
	</>
);

export default LandingLayout;
