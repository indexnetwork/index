import SiteNavbar from "layout/site/SiteNavbar";
import Head from "next/head";
import React from "react";
import SiteFooter from "../SiteFooter";

export interface PageLayoutProps {
	hasFooter?: boolean;
	headerType?: "user" | "public";
	isLanding?: boolean;
}
const PageLayout: React.FC<PageLayoutProps> = ({
	children, headerType = "user", hasFooter = false, isLanding = false,
}) => (
	<>
		<Head>
			<title>Index.as</title>
			{/* <script async src="/scripts/drag-drop-touch.js"></script> */}
		</Head>
		<SiteNavbar headerType={headerType} isLanding={isLanding} />
		{children}
		{hasFooter && <SiteFooter />}
	</>
);

export default PageLayout;
