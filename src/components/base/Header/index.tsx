import React from "react";
import { HeaderSizeType } from "types";
import cc from "classcat";

export interface HeaderProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement> {
	level?: HeaderSizeType;
	fontFamily?: "roquefort" | "default";
}

const Header: React.FC<HeaderProps> = ({
	level = 3, fontFamily = "default", children, ...headerProps
}) => (
	React.createElement(`h${level}`, { ...headerProps, className: cc([fontFamily, headerProps.className]) }, children)
);
export default Header;
