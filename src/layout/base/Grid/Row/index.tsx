import React from "react";
import cc from "classcat";
import { SpacingBaseType } from "types";

export interface RowProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	noGutters?: boolean;
	rowSpacing?: SpacingBaseType;
	colSpacing?: SpacingBaseType;
}

const Row: React.FC<RowProps> = ({
	children,
	className,
	rowSpacing,
	colSpacing,
	noGutters = true,
	...divProps
}) => (
	<div
		className={cc([
			"idx-row",
			rowSpacing ? `idx-row-spacing-v${rowSpacing}` : "",
			colSpacing ? `idx-row-spacing-h${colSpacing}` : "",
			noGutters ? "row-no-gutters" : "row",
			className || "",
		])}
		{...divProps}
	>
		{children}
	</div>);

export default Row;
