import React, { useEffect, useState } from "react";
import cc from "classcat";
import Text from "../Text";
import IconUpArrow from "../Icon/IconUpArrow";

export interface CollapseProps {
	title: string;
	className?: string;
	collapsed?: boolean;
	onChange?(collapsed: boolean): void;
}

const Collapse: React.FC<CollapseProps> = ({
	children,
	title,
	className,
	collapsed = false,
	onChange,
}) => {
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
				"idx-collapse",
				isCollapsed ? "idx-collapse-collapsed" : "",
				className || "",
			])}>
			<div
				className="idx-collapse-header"
				onClick={handleToggle}
			>
				<IconUpArrow className="idx-collapse-arrow" />
				<Text theme="gray5" className="idx-collapse-title" size="sm" fontWeight={700}>{title}</Text>
			</div>
			<div className="idx-collapse-body">
				{children}
			</div>
		</div>
	);
};

export default Collapse;
