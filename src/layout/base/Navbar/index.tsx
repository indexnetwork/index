import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React, { useEffect, useState } from "react";
import cc from "classcat";
import { useYOffSet } from "hooks/useYOffset";
import Container from "../Grid/Container";
import Col from "../Grid/Col";
import FlexRow from "../Grid/FlexRow";

export interface NavbarProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	logoSize?: "full" | "mini";
	sticky?: boolean;
	stickyBgChangeAfter?: number;
	stickyBgColor?: string;
	bordered?: boolean;
	bgColor?: string;
}

export interface NavbarMenuProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	placement?: "left" | "right" | "center";
}

const Navbar: React.FC<NavbarProps> = ({
	children,
	logoSize = "mini",
	sticky = false,
	stickyBgChangeAfter = 30,
	stickyBgColor = "#fff",
	bgColor,
	bordered = true,
	style,
	...menuProps
}) => {
	const yOffSet = useYOffSet(sticky);
	const [bgSticky, setBgSticky] = useState(false);

	useEffect(() => {
		if (sticky) {
			if (typeof yOffSet === "number") {
				if (yOffSet > stickyBgChangeAfter) {
					!bgSticky && setBgSticky(true);
				} else {
					bgSticky && setBgSticky(false);
				}
			}
		}
	}, [bgSticky, sticky, stickyBgChangeAfter, stickyBgColor, yOffSet]);

	return (
		<div
			className={cc([
				"idx-navbar-container",
				sticky ? "idx-navbar-sticky" : "",
				bordered ? "idx-navbar-bordered" : "",
			])}
			style={sticky || bgColor ? {
				...style,
				backgroundColor: sticky && bgSticky ? stickyBgColor : bgColor,
			} : style}
			{...menuProps}
		>
			<Container
				className="idx-navbar"
			>
				<FlexRow
					fullHeight
					align="center"
					justify="between"
					wrap={false}
				>
					<Col>
						{logoSize === "mini" ? <LogoMini /> : <LogoFull />}
					</Col>
					<Col>
						{children}
					</Col>
				</FlexRow>
			</Container>
		</div>
	);
};

export const NavbarMenu: React.FC<NavbarMenuProps> = ({
	className, children, placement = "left", ...props
}) => <div {...props} className={cc([`idx-navbar-menu-${placement}`, className || ""])}>{children}</div>;

export default Navbar;
