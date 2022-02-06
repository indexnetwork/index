import React from "react";

export interface FlexProps extends Partial<React.CSSProperties> {
	className?: string;
}

const Flex: React.FC<FlexProps> = ({
	className, children, ...props
}) => (
	<div className={className} style={{ ...props, display: "flex" }} >{children}</div>
);

export default Flex;
