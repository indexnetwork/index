import * as React from "react";

const IconFilter: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
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
			d="M7.66 3.27h6.955M1.385 3.27h2.622M1.385 8h7.24M1.385 12.73h2.622M5.834 5.145c1.009 0 1.827-.84 1.827-1.875 0-1.035-.818-1.874-1.827-1.874-1.01 0-1.827.839-1.827 1.874 0 1.035.818 1.875 1.827 1.875ZM10.452 9.875c1.009 0 1.827-.84 1.827-1.875 0-1.035-.818-1.875-1.827-1.875-1.01 0-1.827.84-1.827 1.875 0 1.035.818 1.875 1.827 1.875ZM5.834 14.604c1.009 0 1.827-.839 1.827-1.874 0-1.035-.818-1.875-1.827-1.875-1.01 0-1.827.84-1.827 1.875 0 1.035.818 1.874 1.827 1.874ZM12.279 8h2.335M7.66 12.73h6.955"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconFilter;
