import * as React from "react";

const IasIconSort: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
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
			d="m7.728 6.117 3.44-4.155 3.449 4.155M11.169 14.038V1.962M8.272 9.884l-3.44 4.154-3.449-4.154M4.831 14.038V1.962"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IasIconSort;
