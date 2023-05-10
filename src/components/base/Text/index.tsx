import React from "react";
import { TextThemeType, TextElementType, TextSizeType } from "types";
import cc from "classcat";

export interface TextProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> {
	theme?: TextThemeType;
	size?: TextSizeType;
	fontWeight?: number;
	fontFamily?: string;
	verticalAlign?: string;
	lineHeight?: number | string;
	element?: TextElementType;
	hidden?: boolean;
}

const Text = (
	{
		children,
		className,
		style,
		fontWeight,
		fontFamily = "default",
		lineHeight,
		verticalAlign,
		element = "span",
		theme = "gray5",
		size = "md",
		hidden = false,
		...moreProps
	}: TextProps,
) => React.createElement(element, {
	className: cc(
		[
			"text",
			`text-${theme}`,
			`text-${size}`,
			hidden ? "hidden" : "",
			className || "",
			fontFamily,
		],
	),
	style: fontWeight || lineHeight || style ? {
		fontWeight,
		fontFamily,
		lineHeight,
		verticalAlign,
		...style,
	} : undefined,
	...moreProps,
}, children);

export default Text;
