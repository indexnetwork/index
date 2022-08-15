import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React from "react";
import cc from "classcat";
import Container from "../Grid/Container";
import Col from "../Grid/Col";
import FlexRow from "../Grid/FlexRow";

export interface FooterProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	logoSize?: "full" | "mini";
	sticky?: boolean;
	bordered?: boolean;
	bgColor?: string;
}

export interface FooterMenuProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	placement?: "left" | "right" | "center";
}

const Footer: React.FC<FooterProps> = ({
	children,
	logoSize = "full",
	bgColor,
	bordered = false,
	style,
	sticky,
	...menuProps
}) => (
	<div
		className={cc([
			"footer-container",
			sticky ? "footer-sticky" : "",
			bordered ? "footer-bordered" : "",
		])}
		style={bgColor ? {
			...style,
			backgroundColor: bgColor,
		} : style}
		{...menuProps}
	>
		<Container
			className="footer"
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

export const FooterMenu: React.FC<FooterMenuProps> = ({
	className, children, placement = "left", ...props
}) => <div {...props} className={cc([`navbar-menu-${placement}`, className || ""])}>{children}</div>;

export default Footer;
