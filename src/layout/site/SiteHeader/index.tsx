import Button from "components/base/Button";
import React from "react";
import Navbar, { NavbarProps, NavbarMenuRight } from "../../base/Navbar";

export interface LandingHeaderProps extends NavbarProps {
	headerType: "public" | "user";
}

const SiteHeader: React.FC<LandingHeaderProps> = ({ headerType, ...baseProps }) => {
	const renderPublicHeader = () => (
		<Navbar
			logoSize="full"
			sticky
			bordered={false}
			{...baseProps}
		>
			<NavbarMenuRight placement="right">
				<Button theme="ghost" >Sign In</Button>
				<Button theme="primary">Sign Up</Button>
			</NavbarMenuRight>
		</Navbar>
	);

	const renderUserHeader = () => (
		<Navbar
			logoSize="mini"
			{...baseProps}
		>
			<NavbarMenuRight placement="right">
				<Button theme="ghost">Sign in</Button>
				<Button theme="primary">Sign Up</Button>
			</NavbarMenuRight>
		</Navbar>
	);

	return headerType === "user" ? renderUserHeader() : renderPublicHeader();
};

export default SiteHeader;
