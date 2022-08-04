import React from "react";
import cc from "classcat";
import { InputSizeType, TextThemeType } from "types";

export interface SpinProps {
	active: boolean;
	size?: InputSizeType;
	wrapsChildren?: boolean;
	theme?: TextThemeType;
	thickness?: "light" | "medium" | "strong";
	className?: string;
	hidden?: boolean;
}

const Spin: React.FC<SpinProps> = ({
	active,
	size,
	wrapsChildren = true,
	children,
	theme = "primary",
	thickness = "medium",
	className,
	hidden,
}) => (
	<div
		className={cc([
			"idx-spin",
			`idx-spin-${theme}`,
			active ? "idx-spin-active" : "",
			hidden ? "idx-spin-hidden" : "",
			size ? `idx-spin-size-${size}` : "",
			`idx-spin-${thickness}`,
			wrapsChildren ? "" : "idx-spin-solo",
			className || "",
		])}
	>
		{wrapsChildren && <div className="idx-spin-bg"></div>}
		<div className="idx-spin-spinner">
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
	</div>
);

export default Spin;
