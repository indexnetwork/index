import * as React from "react";

const IconAdd = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
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
			d="M2 8h6v5.99M13.99 8H8V2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconAdd;
