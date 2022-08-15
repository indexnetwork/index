import * as React from "react";

const IconCopy: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
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
			d="M3.067 11.116h-.135a1.574 1.574 0 0 1-1.574-1.567V2.924a1.574 1.574 0 0 1 1.574-1.566h6.617a1.574 1.574 0 0 1 1.574 1.566"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M13.219 14.642h-6.91a1.43 1.43 0 0 1-1.432-1.43V6.3a1.43 1.43 0 0 1 1.431-1.43h6.91A1.43 1.43 0 0 1 14.65 6.3v6.91a1.43 1.43 0 0 1-1.431 1.431Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>ƒ
	</svg>
);

export default IconCopy;
