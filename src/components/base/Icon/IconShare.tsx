import * as React from "react";

const IconShare: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
	<svg className="idx-icon"
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
			d="M5.691 6.956a2.35 2.35 0 1 0 0 2.099M12.402 5.95a2.355 2.355 0 1 0-2.1-1.3M10.302 11.36a2.35 2.35 0 1 0 2.1-1.298"
			stroke="#7f7f7f"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M12.402 5.95a2.35 2.35 0 0 1-2.1-1.3L5.69 6.957c.334.66.334 1.44 0 2.1l4.61 2.305a2.35 2.35 0 0 1 2.1-1.3"
			stroke="#7f7f7f"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconShare;
