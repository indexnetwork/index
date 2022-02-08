import React, { ReactElement, useRef, useState } from "react";
import cc from "classcat";
import useBackdropClick from "hooks/useBackdropClick";
import DropdownMenu from "./DropdownMenu";
import { DropdownMenuItemProps } from "./DropdownMenuItem";

export interface DropdownProps {
	trigger?: "click" | "hover" | "both";
	position?: "bottom-left" | "bottom-right" | "bottom-center" | "top-left" | "top-right" | "top-center";
	delay?: number;
	closeOnHoverOut?: boolean;
	menuClass?: string;
	dropdownClass?: string;
	menuItems: ReactElement<DropdownMenuItemProps> | ReactElement<DropdownMenuItemProps>[];
}

const Dropdown: React.FC<DropdownProps> = ({
	menuItems,
	children,
	menuClass,
	trigger = "click",
	position = "bottom-center",
	delay = 500,
	closeOnHoverOut = false,
}) => {
	const menuRef = useRef<HTMLDivElement>(null);

	const [visible, setVisible] = useState(false);

	const timeout = useRef<NodeJS.Timeout>();

	const handleMouseEnter = () => {
		timeout.current = setTimeout(() => {
			setVisible(true);
		}, delay);
	};

	const handleMouseLeave = () => {
		if (closeOnHoverOut) {
			if (timeout.current) {
				clearTimeout(timeout.current);
				timeout.current = undefined;
			}
			setVisible(false);
		}
	};

	const handleClick = () => {
		setVisible((oldVal) => !oldVal);
	};

	const handleClose = () => {
		setVisible(false);
	};

	useBackdropClick(menuRef, handleClose, visible);

	return (
		<div
			ref={menuRef}
			className={cc(["idx-dropdown", menuClass || ""])}
			onMouseEnter={trigger === "both" || trigger === "hover" ? handleMouseEnter : undefined}
			onMouseLeave={trigger === "both" || trigger === "hover" ? handleMouseLeave : undefined}
			onClick={trigger === "both" || trigger === "click" ? handleClick : undefined}
		>
			{children}
			{
				visible &&
					<DropdownMenu className={cc([`idx-dropdown-menu-${position}`, menuClass || ""])}>
						{menuItems}
					</DropdownMenu>
			}
		</div>
	);
};

export default Dropdown;
