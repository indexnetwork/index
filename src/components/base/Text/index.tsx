import React from "react";
import { TextThemeType, TextElementType, TextSizeType } from "types";
import cc from "classcat";

export interface TextProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> {
	theme?: TextThemeType;
	size?: TextSizeType;
	fontWeight?: number;
	verticalAlign?: string;
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
	verticalAlign,
	element = "span",
	theme = "gray5",
	size = "md",
	hidden = false,
	...moreProps
}) => React.createElement(element, {
	className: cc(
		[
			"text",
			`text-${theme}`,
			`text-${size}`,
			hidden ? "hidden" : "",
			className || "",
		],
	),
	style: fontWeight || lineHeight || style ? {
		fontWeight,
		lineHeight,
		verticalAlign,
		...style,
	} : undefined,
	...moreProps,
}, children);

export default Text;
