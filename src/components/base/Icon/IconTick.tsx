import * as React from "react";

const IconTick: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
	<svg className="icon"
		width={16}
		height={16}
		viewBox="0 0 16 16"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<path
			d="m14.06 3-7.51 9.76a.609.609 0 0 1-1 0L1.9 8.18"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconTick;
