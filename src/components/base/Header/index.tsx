import React from "react";
import { HeaderSizeType, TextThemeType } from "types";
import cc from "classcat";

export interface HeaderProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement> {
	level?: HeaderSizeType;
	fontFamily?: "roquefort" | "default";
	theme?: TextThemeType;
}

const Header = (
	{
		level = 3,
		fontFamily = "default",
		theme,
		children,
		...headerProps
	}: HeaderProps,
) => (React.createElement(`h${level}`, {
	...headerProps,
	className: cc([fontFamily, theme ? `text-${theme}` : undefined,
		headerProps.className]),
}, children));
export default Header;
