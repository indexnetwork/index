import React from "react";
import cc from "classcat";
import { TextThemeType } from "types";

export interface SpinProps {
	active: boolean;
	size?: "sm" | "md" | "lg";
	wrapsChildren?: boolean;
	theme?: TextThemeType;
	thickness?: "light" | "medium" | "strong";
}

const Spin: React.FC<SpinProps> = ({
	active, size, wrapsChildren = true, children, theme = "primary", thickness = "medium",
}) => (
	<div
		className={cc([
			"idx-spin",
			`idx-spin-${theme}`,
			active ? "idx-spin-active" : "",
			size ? `idx-spin-size-${size}` : "",
			`idx-spin-${thickness}`,
			wrapsChildren ? "" : "idx-spin-solo",
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
