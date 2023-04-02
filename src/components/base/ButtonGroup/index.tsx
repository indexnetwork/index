import React from "react";
import { ButtonThemeType, InputSizeType } from "types";
import cc from "classcat";
import { ButtonProps } from "../Button";

export interface ButtonGroupProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	theme?: ButtonThemeType;
	size?: InputSizeType;
	outlined?: boolean;
	children?: React.ReactElement<ButtonProps>[];
}

const ButtonGroup = (
	{
		children,
		className,
		outlined,
		theme = "primary",
		size = "md",
		...divProps
	}: ButtonGroupProps,
) => <div
	{...divProps}
	className={
		cc([
			"btn-group",
			`btn-group-${theme}`,
			`btn-group-${size}`,
			className || "",
		])
	}>{
		children &&
			React.Children.map(children, (child: React.ReactElement<any>) => <div className="btn-group-item">{
				child
			}
			</div>)
	}</div>;

export default ButtonGroup;
