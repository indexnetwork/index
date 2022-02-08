import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React from "react";
import cc from "classcat";
import { FlexPropsType } from "types";
import Flex from "../Grid/Flex";

export interface FooterProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	logoSize?: "full" | "mini";
	sticky?: boolean;
	bordered?: boolean;
	bgColor?: string;
	innerFlexProps?: FlexPropsType;
}

export interface FooterMenuProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	placement?: "left" | "right" | "center";
}

const Footer: React.FC<FooterProps> = ({
	children,
	innerFlexProps,
	logoSize = "full",
	bgColor,
	bordered = false,
	style,
	sticky,
	...menuProps
}) => (
	<div
		className={cc([
			"idx-footer-container",
			sticky ? "idx-footer-sticky" : "",
			bordered ? "idx-footer-bordered" : "",
		])}
		style={bgColor ? {
			...style,
			backgroundColor: bgColor,
		} : style}
		{...menuProps}
	>
		<div className="container idx-footer">
			<Flex
				className="idx-flex-container"
				alignItems="center"
				{...innerFlexProps}
			>
				<div className="idx-footer-logo">
					{
						logoSize === "mini" ? <LogoMini /> : <LogoFull />
					}
				</div>
				{children}
			</Flex>
		</div>
	</div>
);

export const FooterMenu: React.FC<FooterMenuProps> = ({
	className, children, placement = "left", ...props
}) => <div {...props} className={cc([`idx-navbar-menu-${placement}`, className || ""])}>{children}</div>;

export default Footer;
