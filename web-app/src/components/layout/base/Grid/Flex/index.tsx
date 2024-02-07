import React from "react";
import styled from "styled-components";
import { FlexPropsType } from "types";

export interface FlexProps
  extends FlexPropsType,
    React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLDivElement>,
      HTMLDivElement
    > {
  inline?: boolean;
}

const Flex = styled.div<FlexProps>`
  ${({
    flex,
    inline,
    flexBasis,
    flexdirection,
    flexFlow,
    flexGrow,
    flexShrink,
    flexWrap,
    order,
    alignContent,
    alignSelf,
    alignitems,
    justifySelf,
    justifyItems,
    gap,
  }) => `
flex: ${flex || ""};
display: ${inline ? "inline-flex" : "flex"};
flex-basis: ${flexBasis || ""};
flex-direction: ${flexdirection || ""};
flex-flow: ${flexFlow || ""};
flex-grow: ${flexGrow || ""};
flex-shrink: ${flexShrink || ""};
flex-wrap: ${flexWrap || ""};
order: ${order || ""};
align-content: ${alignContent || ""};
align-self: ${alignSelf || ""};
align-items: ${alignitems || ""};
justify-content: ${alignitems || ""};
justify-self: ${justifySelf || ""};
justify-items: ${justifyItems || ""};
gap: ${gap || ""};
`}
`;

export default Flex;
