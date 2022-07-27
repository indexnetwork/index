import React from "react";
import styled from "styled-components";
import { FlexPropsType } from "types";

export interface FlexProps extends FlexPropsType, React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	inline?: boolean;
}

const Flex = styled.div<FlexProps>`
${({
		flex,
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
		gap,
	}) => `
flex: ${flex || ""};
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
gap: ${gap || ""};
`}`;

export default Flex;
