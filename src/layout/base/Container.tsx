import React from "react";
import cc from "classcat";

export interface ContainerProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	fluid?: boolean;
}

const Container: React.FC<ContainerProps> = ({
	children, className, fluid = false, ...divProps
}) => (
	<div
		className={cc([fluid ? "container-fluid" : "container", className || ""])}
		{...divProps}
	>
		{children}
	</div>);

export default Container;
