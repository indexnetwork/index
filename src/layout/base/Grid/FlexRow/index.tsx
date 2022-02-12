import React from "react";
import cc from "classcat";
import { SpacingBaseType } from "types";

export interface FlexRowProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	flex?: boolean;
	colGap?: SpacingBaseType;
	rowGap?: SpacingBaseType;
	gap?: SpacingBaseType;
	rowSpacing?: SpacingBaseType;
	colSpacing?: SpacingBaseType;
	wrap?: boolean;
}

const FlexRow: React.FC<FlexRowProps> = ({
	children,
	className,
	gap,
	rowGap,
	colGap,
	wrap,
	rowSpacing,
	colSpacing,
	...divProps
}) => (
	<div
		className={cc([
			"idx-flex",
			gap ? `idx-flex-gap-${gap}` : "",
			rowGap ? `idx-flex-row-gap-${rowGap}` : "",
			colGap ? `idx-flex-row-gap-${colGap}` : "",
			rowSpacing ? `idx-row-spacing-v${rowSpacing}` : "",
			colSpacing ? `idx-row-spacing-h${colSpacing} idx-flex-row-gutter-${colSpacing}` : "",
			wrap === false ? "" : "idx-flex-wrap",
			className || "",
		])}
		{...divProps}
	>
		{children}
	</div>);

export default FlexRow;
