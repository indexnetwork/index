import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React from "react";
import cm from "./style.module.scss";

export interface NavbarProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	logoSize?: "Full" | "Mini";
	sticky?: boolean;
}

const Navbar: React.FC<NavbarProps> = ({
	children, logoSize = "Mini", sticky = false, ...menuProps
}) => (
	<div
		{...menuProps}
	>
		<div>
			<div
				className={cm.logo}
			>
				{
					logoSize === "Mini" ? <LogoMini /> : <LogoFull />
				}
			</div>
			{children}
		</div>
	</div>
);

export default Navbar;
