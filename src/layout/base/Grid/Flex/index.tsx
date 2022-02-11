import React from "react";
import styled from "styled-components";
import { FlexPropsType } from "types";

export interface FlexProps extends FlexPropsType, React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	inline?: boolean;
}

const Flex = styled.div<FlexProps>`
${({
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
	}) => `
display: ${inline ? "inline-flex" : "flex"};
flex-basis: ${flexBasis || ""};
flex-direction: ${flexDirection || ""};
flex-flow: ${flexFlow || ""};
flex-grow: ${flexGrow || ""};
flex-shrink: ${flexShrink || ""};
flex-wrap: ${flexWrap || ""};
order: ${order || ""};
align-content: ${alignContent || ""};
align-self: ${alignSelf || ""};
align-items: ${alignItems || ""};
justify-content: ${justifyContent || ""};
justify-self: ${justifySelf || ""};
justify-items: ${justifyItems || ""};
`}
`;

// const Flex: React.FC<FlexProps> = ({
// 	className,
// 	children,
// 	inline,
// 	flexBasis,
// 	flexDirection,
// 	flexFlow,
// 	flexGrow,
// 	flexShrink,
// 	flexWrap,
// 	order,
// 	alignContent,
// 	alignSelf,
// 	alignItems,
// 	justifyContent,
// 	justifySelf,
// 	justifyItems,
// 	style,
// 	...props
// }) => (
// 	<div
// 		className={className}
// 		style={{
// 			...style,
// 			display: inline ? "inline-flex" : "flex",
// 			flexBasis,
// 			flexDirection,
// 			flexFlow,
// 			flexGrow,
// 			flexShrink,
// 			flexWrap,
// 			order,
// 			alignContent,
// 			alignSelf,
// 			alignItems,
// 			justifyContent,
// 			justifySelf,
// 			justifyItems,
// 		}}
// 		{...props}
// 	>{children}</div>
// );

export default Flex;
