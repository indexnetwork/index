import React, {
	ReactElement, useEffect, useRef, useState,
} from "react";
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
	closeOnMenuClick?: boolean;
	menuItems: ReactElement<DropdownMenuItemProps> | ReactElement<DropdownMenuItemProps>[];
}

const Dropdown: React.FC<DropdownProps> = ({
	menuItems,
	children,
	menuClass,
	trigger = "click",
	position = "bottom-center",
	delay = 500,
	closeOnMenuClick = true,
	closeOnHoverOut = false,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLUListElement>(null);

	const [visible, setVisible] = useState(false);

	const timeout = useRef<NodeJS.Timeout>();
	const cancelHover = useRef<boolean>();

	const handleMouseEnter = () => {
		timeout.current = setTimeout(() => {
			if (!cancelHover.current) {
				setVisible(true);
			}
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

	const handleClick = (e: any) => {
		cancelHover.current = true;
		if (!closeOnMenuClick && menuRef.current && menuRef.current!.contains(e.target!)) {
			return;
		}
		setVisible((oldVal) => !oldVal);
	};

	const handleClose = () => {
		setVisible(false);
	};

	useBackdropClick(containerRef, handleClose, visible);

	useEffect(() => {
		if (cancelHover.current) {
			timeout.current && clearTimeout(timeout.current);
			cancelHover.current = false;
		}
	}, [visible, cancelHover]);

	return (
		<div
			ref={containerRef}
			className={cc(["idx-dropdown", menuClass || ""])}
			onMouseEnter={trigger === "both" || trigger === "hover" ? handleMouseEnter : undefined}
			onMouseLeave={trigger === "both" || trigger === "hover" ? handleMouseLeave : undefined}
			onClick={trigger === "both" || trigger === "click" ? handleClick : undefined}
		>
			{children}
			{
				visible &&
					<DropdownMenu ref={menuRef} className={cc([`idx-dropdown-menu-${position}`, menuClass || ""])}>
						{menuItems}
					</DropdownMenu>
			}
		</div>
	);
};

export default Dropdown;
