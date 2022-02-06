import * as React from "react";

const IconContextMenu = ({
	stroke = "var(--gray-4)", fill = "var(--gray-4)", strokeWidth = ".1", ...props
}) => (
	<svg
		width={16}
		height={16}
		viewBox="0 0 16 16"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		fill={fill}
		{...props}
	>
		<g clipPath="url(#a)">
			<path d="M2.8 9.63a1.63 1.63 0 1 0 0-3.26 1.63 1.63 0 0 0 0 3.26ZM8 9.63a1.63 1.63 0 1 0 0-3.26 1.63 1.63 0 0 0 0 3.26ZM13.2 9.63a1.63 1.63 0 1 0 0-3.26 1.63 1.63 0 0 0 0 3.26Z" />
		</g>
		<defs>
			<clipPath id="a">
				<path
					transform="translate(1.17 6.37)"
					d="M0 0h13.66v3.26H0z"
				/>
			</clipPath>
		</defs>
	</svg>
);

export default IconContextMenu;
