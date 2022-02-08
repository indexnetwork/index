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

const ButtonGroup: React.FC<ButtonGroupProps> = ({
	children, className, outlined, theme = "primary", size = "md", ...divProps
}) => <div
	{...divProps}
	className={
		cc([
			"idx-button-group",
			`idx-button-group-${theme}`,
			`idx-button-group-${size}`,
			className || "",
		])
	}>{
		children &&
			React.Children.map(children, (child: React.ReactElement<ButtonProps>) => <div className="idx-button-group-item">{React.cloneElement(child, {
				...child.props,
				theme,
				size,
				outlined,
				block: false,
				className: "idx-button-group-item",
			})
			}
			</div>)
	}</div>;

export default ButtonGroup;
