import cc from "classcat";
import IconGoogle from "components/base/Icon/IconGoogle";
import IconTwitter from "components/base/Icon/IconTwitter";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import {
	ButtonThemeType,
	InputSizeType,
} from "types";

export interface ButtonProps extends React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
	customType?: "google" | "twitter";
	theme?: ButtonThemeType;
	size?: InputSizeType;
	block?: boolean;
	outlined?: boolean;
	addOnBefore?: React.ReactNode;
	addOnAfter?: React.ReactNode;
	iconButton?: boolean;
	group?: boolean;
	borderless?: boolean;
}

const Button: React.FC<ButtonProps> = ({
	customType,
	children,
	className,
	borderless,
	group,
	block,
	iconButton,
	outlined,
	addOnBefore,
	addOnAfter,
	theme = "primary",
	size = "md",
	...props
}) => {
	switch (customType) {
		case "google":
			return <button {...props} className={cc(
				[
					"btn",
					`btn-${theme}`,
					`btn-${size}`,
					block && !group ? "btn-block" : "",
					group ? "btn-group-item" : "",
					iconButton ? `btn-icon btn-icon-${size}` : "",
					borderless ? "btn-borderless" : "",
					className,
				],
			)}>
				<IconGoogle width={20} />
				{children}
			</button>;
		case "twitter":
			return <button {...props} className={cc(
				[
					"btn",
					outlined ? `btn-${theme}-outlined` : `btn-${theme}`,
					block ? "btn-block" : "",
					iconButton ? `btn-icon btn-icon-${size}` : "",
					borderless ? "btn-borderless" : "",
					className,
				],
			)}>
				<IconTwitter height={20} fill="var(--twitter-blue)" />
				{children}
			</button>;
		default:
			return <button
				{...props}
				className={cc(
					[
						"btn",
						`btn-${theme}`,
						`btn-${size}`,
						block ? "btn-block" : "",
						addOnBefore ? "btn-addon-b" : "",
						addOnAfter ? "btn-addon-a" : "",
						iconButton ? `btn-icon btn-icon-${size}` : "",
						borderless ? "btn-borderless" : "",
						className,
					],
				)}>
				{addOnAfter || addOnBefore ? <Flex className="btn-inner" inline alignItems="center">{addOnBefore}{children}{addOnAfter}</Flex> : children}
			</button>;
	}
};

export default Button;
