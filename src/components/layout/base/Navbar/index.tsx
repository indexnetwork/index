import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React, { useEffect, useState } from "react";
import cc from "classcat";
import { useYOffSet } from "hooks/useYOffset";
import { useRouter } from "next/router";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { useAuth } from "hooks/useAuth";
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
	className,
	...menuProps
}) => {
	const yOffSet = useYOffSet(sticky);
	const [bgSticky, setBgSticky] = useState(false);

	const { address } = useAppSelector(selectConnection);
	const authenticated = useAuth();
	const router = useRouter();

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

	const handleLogoClick = () => {
		if (authenticated) {
			router.push(`/${address}`);
		} else {
			router.push(`/`);
		}
	};
	return (
		<div
			className={cc([
				className,
				"navbar-container",
				sticky ? "navbar-sticky" : "",
				bordered ? "navbar-bordered" : "",
			])}
			style={sticky || bgColor ? {
				...style,
				backgroundColor: sticky && bgSticky ? stickyBgColor : bgColor,
			} : style}
			{...menuProps}
		>
			<Container
				className="navbar"
			>
				<FlexRow
					fullHeight
					align="center"
					justify="between"
					wrap={false}
				>
					<Col>
						{logoSize === "mini" ? <LogoMini className="navbar-logo" onClick={handleLogoClick} style={{
							cursor: "pointer",
						}} /> : <LogoFull className="navbar-logo navbar-logo-full" />}
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
}) => <div {...props} className={cc([`navbar-menu-${placement}`, className || ""])}>{children}</div>;

export default Navbar;
