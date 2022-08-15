import * as React from "react";

const IconWorld: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
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
			d="M8 14.09A6.09 6.09 0 1 0 8 1.91a6.09 6.09 0 0 0 0 12.18Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M2.548 5.724H3.94A1.392 1.392 0 0 1 5.487 7.15a2.071 2.071 0 0 1-.77 1.465A2.521 2.521 0 0 0 3.506 10.8v1.285M10.235 2.335v1.433a2.375 2.375 0 0 1-1.154 1.89c-.91.64-1.351 1.114-1.351 1.818a1.35 1.35 0 0 0 1.35 1.35h2.023a.818.818 0 0 1 .818.82c0 .27-.057.646-.761 1.015a1.416 1.416 0 0 0-.925 1.465v1.375"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconWorld;
