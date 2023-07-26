import SiteNavbar from "components/layout/site/SiteNavbar";
import Head from "next/head";
import React from "react";
import SiteFooter from "../SiteFooter";

export interface PageLayoutProps {
	hasFooter?: boolean;
	headerType?: "user" | "public";
	isLanding?: boolean;
	children: React.ReactNode;
}
const PageLayout = (
	{
		children,
		headerType = "user",
		hasFooter = false,
		isLanding = false,
	}: PageLayoutProps,
) => (<>
	<Head>
		<title>index network</title>
		{/* <script async src="/scripts/drag-drop-touch.js"></script> */}
	</Head>
	<SiteNavbar headerType={headerType} isLanding={isLanding} />
	{children}
	{hasFooter && <SiteFooter />}
</>);

export default PageLayout;
