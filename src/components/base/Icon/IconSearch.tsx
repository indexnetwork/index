import * as React from "react";

const IconSearch: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
	<svg
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
			d="M6.958 11.812c2.775 0 5.025-2.214 5.025-4.944s-2.25-4.943-5.025-4.943c-2.776 0-5.026 2.213-5.026 4.943 0 2.73 2.25 4.944 5.026 4.944Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="m11.274 9.889 2.5 2.459a1.012 1.012 0 0 1 0 1.429v0a1.047 1.047 0 0 1-1.454 0l-2.5-2.459"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconSearch;
