import * as React from "react";

const IconLogout: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
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
			d="M10.667 11.333 14 8l-3.333-3.333M14 8H6M6 14H3.333A1.334 1.334 0 0 1 2 12.667V3.333A1.333 1.333 0 0 1 3.333 2H6"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconLogout;
