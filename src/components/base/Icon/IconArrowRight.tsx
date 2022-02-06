import * as React from "react";

const IasIconArrowRight = ({ stroke = "var(--main)", strokeWidth = "1.2", ...props }) => (
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
			d="m9.922 4.501 4.155 3.44-4.155 3.449M14.077 7.942H2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IasIconArrowRight;
