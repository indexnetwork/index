import * as React from "react";

const IconLock = ({ stroke = "var(--main)", strokeWidth = "1.5", ...props }) => (
	<svg
		width={24}
		height={24}
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<path
			clipRule="evenodd"
			d="M19.76 11.543a1.826 1.826 0 0 0-1.825-1.826H6.065a1.826 1.826 0 0 0-1.826 1.826v9.13c0 1.01.818 1.827 1.826 1.827h11.87a1.826 1.826 0 0 0 1.826-1.826v-9.13Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			clipRule="evenodd"
			d="M6.978 6.522a5.022 5.022 0 0 1 10.044 0v3.195H6.978V6.522Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M12 17.25a1.141 1.141 0 1 0 0-2.283 1.141 1.141 0 0 0 0 2.283Z"
			fill={stroke}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconLock;
