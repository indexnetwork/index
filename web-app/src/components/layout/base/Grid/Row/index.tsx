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

const Row = (
	{
		children,
		className,
		rowSpacing,
		colSpacing,
		noGutters = true,
		fullHeight = false,
		fullWidth = false,
		...divProps
	}: RowProps,
) => (<div
	className={cc([
		"row",
		"idxrow",
		fullHeight ? "h-100" : "",
		fullWidth ? "w-100" : "",
		rowSpacing ? `idxrow-spacing-v${rowSpacing}` : "idxrow-spacing-v0",
		colSpacing ? `idxrow-spacing-h${colSpacing}` : "idxrow-spacing-h0",
		noGutters ? "row-no-gutters" : "",
		className || "",
	])}
	{...divProps}
>
	{children}
</div>);

export default Row;
