import * as React from "react";

const IconLink1: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
	<svg
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
			d="M6.678 4.31H4.239a3.036 3.036 0 0 0-2.05.794 2.617 2.617 0 0 0-.855 1.904v1.99a2.61 2.61 0 0 0 .855 1.902 3.03 3.03 0 0 0 2.05.79h2.439M9.323 11.69h2.438a3.03 3.03 0 0 0 2.05-.79 2.61 2.61 0 0 0 .855-1.902v-1.99a2.616 2.616 0 0 0-.855-1.904 3.036 3.036 0 0 0-2.05-.794H9.322M4.393 8h7.214"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconLink1;
