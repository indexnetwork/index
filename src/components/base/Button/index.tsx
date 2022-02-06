import React from "react";
import cc from "classcat";
import IconGoogle from "components/base/Icon/IconGoogle";
import IconTwitter from "components/base/Icon/IconTwitter";
import { ButtonSizeType, ButtonThemeType } from "types";

export interface ButtonProps extends React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
	customType?: "google" | "twitter";
	theme?: ButtonThemeType;
	size?: ButtonSizeType;
	block?: boolean;
	outlined?: boolean;
}

const Button: React.FC<ButtonProps> = ({
	customType, className, block, outlined, theme = "primary", size = "md", ...props
}) => {
	switch (customType) {
		case "google":
			return <button {...props}className={cc(
				[
					"idx-button",
					`idx-button-${theme}`,
					`idx-button-${size}`,
					block ? "idx-button-block" : "",
					className,
				],
			)}>
				<IconGoogle width={20} />
				{props.children}
			</button>;
		case "twitter":
			return <button {...props}className={cc(
				[
					"idx-button",
					outlined ? `idx-button-${theme}-outlined` : `idx-button-${theme}`,
					block ? "idx-button-block" : "",
					className,
				],
			)}>
				<IconTwitter height={20} fill="var(--twitter-blue)" />
				{props.children}
			</button>;
		default:
			return <button
				{...props}
				className={cc(
					[
						"idx-button",
						`idx-button-${theme}`,
						`idx-button-${size}`,
						block ? "idx-button-block" : "",
						className,
					],
				)} />;
	}
};

export default Button;
