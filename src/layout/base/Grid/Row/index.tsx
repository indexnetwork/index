import React from "react";
import cc from "classcat";
import { SpacingBaseType } from "types";

export interface RowProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	noGutters?: boolean;
	rowSpacing?: SpacingBaseType;
	colSpacing?: SpacingBaseType;
	fullHeight?: boolean;
	fullWidth?: boolean;
}

const Row: React.FC<RowProps> = ({
	children,
	className,
	rowSpacing,
	colSpacing,
	noGutters = false,
	fullHeight = false,
	fullWidth = false,
	...divProps
}) => (
	<div
		className={cc([
			"row",
			"idx-row",
			fullHeight ? "idx-h-100" : "",
			fullWidth ? "idx-w-100" : "",
			rowSpacing ? `idx-row-spacing-v${rowSpacing}` : "",
			colSpacing ? `idx-row-spacing-h${colSpacing}` : "",
			noGutters ? "row-no-gutters" : "",
			className || "",
		])}
		{...divProps}
	>
		{children}
	</div>);

export default Row;
