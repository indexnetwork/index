import React from "react";
import cc from "classcat";

export interface SpinProps {
	active: boolean;
	size?: "sm" | "md" | "lg";
}

const Spin: React.FC<SpinProps> = ({ active, size, children }) => (
	<div
		className={cc([
			"idx-spin",
			active ? "idx-spin-active" : "",
			size ? `idx-spin-size-${size}` : "",
		])}
	>
		<div className="idx-spin-bg"></div>
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
		{children}
	</div>
);

export default Spin;
