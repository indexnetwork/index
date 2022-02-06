import Button from "components/base/Button";
import React from "react";
import Navbar, { NavbarProps } from "../../base/Navbar";

export interface LandingHeaderProps extends NavbarProps {
	headerType: "public" | "user";
}

const SiteHeader: React.FC<LandingHeaderProps> = ({ headerType, ...baseProps }) => {
	const renderPublicHeader = () => (
		<Navbar
			logoSize="Mini"
			sticky
			{...baseProps}
		>
			<div>
				<Button theme="ghost" >Sign In</Button>
				<Button theme="primary">Sign Up</Button>
			</div>
		</Navbar>
	);

	const renderUserHeader = () => (
		<Navbar
			logoSize="Full"
			sticky
			{...baseProps}
		>
			<div>
				<Button theme="ghost">Sign in</Button>
				<Button theme="primary">Sign Up</Button>
			</div>
		</Navbar>
	);

	return headerType === "user" ? renderUserHeader() : renderPublicHeader();
};

export default SiteHeader;
