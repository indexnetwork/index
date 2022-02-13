import React from "react";
import cc from "classcat";
import { FlexAlignType, FlexJustifyType, SpacingBaseType } from "types";
import Row, { RowProps } from "../Row";

export interface FlexRowProps extends Omit<RowProps, "noGutters"> {
	flex?: boolean;
	colGap?: SpacingBaseType;
	rowGap?: SpacingBaseType;
	gap?: SpacingBaseType;
	wrap?: boolean;
	align?: FlexAlignType;
	justify?: FlexJustifyType;
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
	align,
	justify,
	...divProps
}) => (
	<Row
		className={cc([
			"idx-flex",
			gap ? `idx-flex-gap-${gap}` : "",
			rowGap ? `idx-flex-row-gap-${rowGap}` : "",
			colGap ? `idx-flex-row-gap-${colGap}` : "",
			rowSpacing ? `idx-row-spacing-v${rowSpacing}` : "",
			colSpacing ? `idx-row-spacing-h${colSpacing} idx-flex-row-gutter-${colSpacing}` : "",
			wrap === false ? "idx-flex-nowrap" : "idx-flex-wrap",
			align ? `idx-flex-a-${align}` : "",
			justify ? `idx-flex-j-${justify}` : "",
			className || "",
		])}
		{...divProps}
	>
		{children}
	</Row>);

export default FlexRow;
