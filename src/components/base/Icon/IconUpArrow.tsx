import * as React from "react";

const IconUpArrow = ({ stroke = "var(--gray-4)", strokeWidth = "1.5", ...props }) => (
	<svg
		width={10}
		height={6}
		fill="none"
		viewBox="0 0 10 6"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<path
			d="M1.25 4.563 4.823.99a.25.25 0 0 1 .354 0L8.75 4.563"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconUpArrow;
