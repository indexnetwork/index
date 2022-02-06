import React from "react";
import cc from "classcat";

export interface RowProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	noGutters?: boolean;
}

const Row: React.FC<RowProps> = ({
	children, className, noGutters = false, ...divProps
}) => (
	<div
		className={cc([noGutters ? "row-no-gutters" : "row", className || ""])}
		{...divProps}
	>
		{children}
	</div>);

export default Row;
