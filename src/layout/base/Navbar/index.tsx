import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React from "react";
import cc from "classcat";
import Flex from "../Grid/Flex";

export interface NavbarProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	logoSize?: "full" | "mini";
	sticky?: boolean;
	stickyAfter?: number;
	bordered?: boolean;
}

export interface NavbarMenuProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	placement?: "left" | "right" | "center";
}

const Navbar: React.FC<NavbarProps> = ({
	children,
	logoSize = "mini",
	sticky = false,
	bordered = true,
	stickyAfter = 50,
	...menuProps
}) => (
	<div
		className={cc([
			"idx-navbar-container",
			sticky ? "idx-navbar-sticky" : "",
			bordered ? "idx-navbar-bordered" : "",
		])}
		{...menuProps}
	>
		<div className="container idx-navbar">
			<Flex className="idx-flex-container" alignItems="center">

				<div className="idx-navbar-logo">
					{
						logoSize === "mini" ? <LogoMini /> : <LogoFull />
					}
				</div>
				{children}
			</Flex>
		</div>
	</div>
);

export const NavbarMenuRight: React.FC<NavbarMenuProps> = ({
	className, children, placement = "left", ...props
}) => <div {...props} className={cc([`idx-navbar-menu-${placement}`, className || ""])}>{children}</div>;

export default Navbar;
