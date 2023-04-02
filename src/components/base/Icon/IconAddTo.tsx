import * as React from "react";

const IconAddTo = (
	{
		stroke = "var(--main)",
		strokeWidth = "1.2",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg className="icon"
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
		d="m8.82 1.63 4.47 4.47-4.47 4.46"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
	<path
		d="M13.29 6.09H3.51a.79.79 0 0 0-.78.79v7.49"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
</svg>);

export default IconAddTo;
