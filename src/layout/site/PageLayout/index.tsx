import SiteNavbar from "layout/site/SiteNavbar";
import Head from "next/head";
import React from "react";
import SiteFooter from "../SiteFooter";

export interface PageLayoutProps {
	hasFooter?: boolean;
}
const PageLayout: React.FC<PageLayoutProps> = ({ children, hasFooter = false }) => (
	<>
		<Head>
			<script async src="scripts/drag-drop-touch.js"></script>
		</Head>
		<SiteNavbar headerType="user" />
		{children}
		{hasFooter && <SiteFooter />}
	</>
);

export default PageLayout;
