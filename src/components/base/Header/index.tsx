import React from "react";
import { HeaderSizeType } from "types";

export interface HeaderProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement> {
	level?: HeaderSizeType;
}

const Header: React.FC<HeaderProps> = ({ level = 3, children, ...headerProps }) => (
	React.createElement(`h${level}`, headerProps, children)
);
export default Header;
