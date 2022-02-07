import React from "react";

export interface HeaderProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement> {
	level?: 1 | 2 | 3 | 4 | 5 | 6;
}

const Header: React.FC<HeaderProps> = ({ level = 3, children, ...headerProps }) => (
	React.createElement(`h${level}`, headerProps, children)
);
export default Header;
