import * as React from "react";

const IconTag: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
	<svg className="icon"
		width={16}
		height={16}
		fill="none"
		viewBox="0 0 16 16"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<path
			d="M13.822 8.17 7.72 14.265a1.188 1.188 0 0 1-1.682 0l-4.28-4.28a1.186 1.186 0 0 1 0-1.682l6.094-6.1a2.798 2.798 0 0 1 2-.776h3.062a1.721 1.721 0 0 1 1.682 1.675v3.1a2.8 2.8 0 0 1-.775 1.97Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M10.395 7.442a1.837 1.837 0 1 0 0-3.674 1.837 1.837 0 0 0 0 3.674Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconTag;
