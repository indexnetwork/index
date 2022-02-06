import React from "react";
import { TextThemeType, TextElementType, TextSizeType } from "types";
import cc from "classcat";

export interface TextProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> {
	theme?: TextThemeType;
	size?: TextSizeType;
	fontWeight?: number;
	lineHeight?: number | string;
	element?: TextElementType;
	hidden?: boolean;
}

const Text: React.FC<TextProps> = ({
	children,
	className,
	style,
	fontWeight,
	lineHeight,
	element = "span",
	theme = "primary",
	size = "md",
	hidden = false,
	...moreProps
}) => React.createElement(element, {
	className: cc(
		[
			"idx-text",
			`idx-text-${theme}`,
			`idx-text-${size}`,
			hidden ? "hidden" : "",
			className || "",
		],
	),
	style: fontWeight || lineHeight || style ? {
		fontWeight,
		lineHeight,
		...style,
	} : undefined,
	...moreProps,
}, children);

export default Text;
