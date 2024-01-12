import cc from "classcat";
import IconGoogle from "components/base/Icon/IconGoogle";
import IconTwitter from "components/base/Icon/IconTwitter";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import {
	ButtonThemeType,
	InputSizeType,
} from "types";
import IconLoading from "../Icon/IconLoading";

export interface ButtonProps extends React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
	customType?: "google" | "twitter" | "link";
	theme?: ButtonThemeType;
	size?: InputSizeType;
	block?: boolean;
	loading?: boolean;
	outlined?: boolean;
	addOnBefore?: React.ReactNode;
	addOnAfter?: React.ReactNode;
	iconButton?: boolean;
	group?: boolean;
	borderless?: boolean;
	iconHover?: boolean;
	fontWeight?: number;
	textAlign?: "left" | "center" | "right";
	link?: any;
}

const Button = (
	{
		customType,
		link,
		children,
		className,
		borderless,
		group,
		iconHover,
		loading,
		block,
		iconButton,
		outlined,
		addOnBefore,
		addOnAfter,
		theme = "primary",
		size = "md",
		fontWeight,
		textAlign,
		...props
	}: ButtonProps,
) => {
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
		case "link":
			return <a href={link} target={"_blank"} rel="noreferrer">
				<button {...props}
						   className={cc(
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
					{children}
				</button>
			</a>;
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
			return (
				<button
					  {...props}
					  style={{
						fontWeight, textAlign,
					  }}
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
						  iconHover ? "btn-hovericon" : "",
						  className,
						],
					  )}
				>
					  {loading ? (
						<Flex className="btn-inner-loading" inline alignItems="center">
							<IconLoading className="icon"/>
							{children}
						</Flex>
					  ) : (
						<>
						  {addOnBefore && (
								<Flex className="btn-inner" inline alignItems="center">
							  {addOnBefore}
							  {children}
								</Flex>
						  )}
						  {!addOnBefore && !addOnAfter && children}
						  {addOnAfter && (
								<Flex className="btn-inner" inline alignItems="center">
							  {children}
							  {addOnAfter}
								</Flex>
						  )}
						</>
					  )}
				</button>
				  );
	}
};

export default Button;
