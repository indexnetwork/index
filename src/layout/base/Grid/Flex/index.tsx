import React from "react";
import { FlexPropsType } from "types";

export interface FlexProps extends FlexPropsType, React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	inline?: boolean;
}

const Flex: React.FC<FlexProps> = ({
	className,
	children,
	inline,
	flexBasis,
	flexDirection,
	flexFlow,
	flexGrow,
	flexShrink,
	flexWrap,
	order,
	alignContent,
	alignSelf,
	alignItems,
	justifyContent,
	justifySelf,
	justifyItems,
	style,
	...props
}) => (
	<div
		className={className}
		style={{
			...style,
			display: inline ? "inline-flex" : "flex",
			flexBasis,
			flexDirection,
			flexFlow,
			flexGrow,
			flexShrink,
			flexWrap,
			order,
			alignContent,
			alignSelf,
			alignItems,
			justifyContent,
			justifySelf,
			justifyItems,
		}}
		{...props}
	>{children}</div>
);

export default Flex;
