import React from "react";
import cc from "classcat";
import IconGoogle from "components/base/Icon/IconGoogle";
import IconTwitter from "components/base/Icon/IconTwitter";
import { InputSizeType, ButtonThemeType } from "types";
import Flex from "layout/base/Grid/Flex";

export interface ButtonProps extends React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
	customType?: "google" | "twitter";
	theme?: ButtonThemeType;
	size?: InputSizeType;
	block?: boolean;
	outlined?: boolean;
	addOnBefore?: React.ReactNode;
	addOnAfter?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
	customType, children, className, block, outlined, addOnBefore, addOnAfter, theme = "primary", size = "md", ...props
}) => {
	switch (customType) {
		case "google":
			return <button {...props} className={cc(
				[
					"idx-button",
					`idx-button-${theme}`,
					`idx-button-${size}`,
					block ? "idx-button-block" : "",
					className,
				],
			)}>
				<IconGoogle width={20} />
				{children}
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
				{children}
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
						addOnBefore ? "idx-button-addon-b" : "",
						addOnAfter ? "idx-button-addon-a" : "",
						className,
					],
				)}>
				{addOnAfter || addOnBefore ? <Flex className="idx-button-inner" inline alignItems="center">{children}</Flex> : children}
			</button>;
	}
};

export default Button;
