import React from "react";
import cc from "classcat";
import { InputSizeType, TextThemeType } from "types";

export interface SpinProps {
	children?: React.ReactNode;
	active: boolean;
	size?: InputSizeType;
	wrapsChildren?: boolean;
	theme?: TextThemeType;
	thickness?: "light" | "medium" | "strong";
	className?: string;
	hidden?: boolean;
}

const Spin = (
	{
		active,
		size,
		wrapsChildren = true,
		children,
		theme = "primary",
		thickness = "medium",
		className,
		hidden,
	}: SpinProps,
) => (<div
	className={cc([
		"spin",
		`spin-${theme}`,
		active ? "spin-active" : "",
		hidden ? "spin-hidden" : "",
		size ? `spin-size-${size}` : "",
		`spin-${thickness}`,
		wrapsChildren ? "" : "spin-solo",
		className || "",
	])}
>
	{wrapsChildren && <div className="spin-bg"></div>}
	<div className="spin-spinner">
		<div>
		</div>
		<div>
		</div>
		<div>
		</div>
		<div>
		</div>
	</div>
	{wrapsChildren && children}
</div>);

export default Spin;
