import Button from "components/base/Button";
import React from "react";
import Navbar, { NavbarProps, NavbarMenu } from "../../base/Navbar";

export interface LandingHeaderProps extends NavbarProps {
	headerType: "public" | "user";
}

const SiteNavbar: React.FC<LandingHeaderProps> = ({ headerType, ...baseProps }) => {
	const renderPublicHeader = () => (
		<Navbar
			logoSize="full"
			sticky
			bgColor="#f4fbf6"
			bordered={false}
			{...baseProps}
		>
			<NavbarMenu placement="right">
				<Button theme="ghost" >Sign In</Button>
				<Button theme="primary">Sign Up</Button>
			</NavbarMenu>
		</Navbar>
	);

	const renderUserHeader = () => (
		<Navbar
			logoSize="mini"
			{...baseProps}
		>
			<NavbarMenu>
				<Button theme="ghost">Sign in</Button>
				<Button theme="primary">Sign Up</Button>
			</NavbarMenu>
		</Navbar>
	);

	return headerType === "user" ? renderUserHeader() : renderPublicHeader();
};

export default SiteNavbar;
