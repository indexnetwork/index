import React, { useEffect, useState } from "react";
import cc from "classcat";
import Text from "../Text";
import IconUpArrow from "../Icon/IconUpArrow";

export interface CollapseProps {
	title: string;
	className?: string;
	collapsed?: boolean;
	onChange?(collapsed: boolean): void;
	children: React.ReactNode;
}

const Collapse = (
	{
		children,
		title,
		className,
		collapsed = false,
		onChange,
	}: CollapseProps,
) => {
	const [isCollapsed, setIsCollapsed] = useState(collapsed);

	const handleToggle = () => {
		setIsCollapsed((oldVal) => !oldVal);
	};

	useEffect(() => {
		onChange && onChange(isCollapsed);
	}, [isCollapsed]);

	return (
		<div className={
			cc([
				"collapse",
				isCollapsed ? "collapse-collapsed" : "",
				className || "",
			])}>
			<div
				className="collapse-header"
				onClick={handleToggle}
			>
				<IconUpArrow className="collapse-arrow" />
				<Text className="collapse-title" size="sm" fontWeight={700}>{title}</Text>
			</div>
			<div className="collapse-body">
				{children}
			</div>
		</div>
	);
};

export default Collapse;
