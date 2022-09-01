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
	rowGutter?: SpacingBaseType;
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
	rowGutter = 0,
	...divProps
}) => (
	<Row
		className={cc([
			"idxflex",
			gap ? `idxflex-gap-${gap}` : "",
			rowGap ? `idxflex-row-gap-${rowGap}` : "",
			colGap ? `idxflex-col-gap-${colGap}` : "",
			rowSpacing ? `idxrow-spacing-v${rowSpacing}` : "",
			colSpacing ? `idxrow-spacing-h${colSpacing} idxflex-row-gutter-${rowGutter}` : "",
			wrap === false ? "idxflex-nowrap" : "idxflex-wrap",
			align ? `idxflex-a-${align}` : "",
			justify ? `idxflex-j-${justify}` : "",
			className || "",
		])}
		{...divProps}
	>
		{children}
	</Row>);

export default FlexRow;
