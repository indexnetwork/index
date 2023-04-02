import SiteNavbar from "components/layout/site/SiteNavbar";
import Head from "next/head";
import React from "react";
import SiteFooter from "../SiteFooter";

export interface LandingLayoutProps {
	title: string;
	className?: string;
	collapsed?: boolean;
	onChange?(collapsed: boolean): void;
	children: React.ReactNode;
}

const LandingLayout = ({
	title,
	className,
	collapsed = false,
	onChange,
	children,
}: LandingLayoutProps) => (
	<>
		<Head>
			<script async src="scripts/drag-drop-touch.js"></script>
		</Head>
		<SiteNavbar headerType="public" />
		{children}
		<SiteFooter />
	</>
);

export default LandingLayout;
