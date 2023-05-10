import * as React from "react";

const IconEmbed = (
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
		d="M9.306 3.77 14.196 8l-4.89 4.23M6.694 12.23 1.81 8l4.883-4.23"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
	<path
		d="M8.005 9.552A1.571 1.571 0 0 0 9.54 7.674a1.568 1.568 0 0 0-2.141-1.139 1.57 1.57 0 0 0-.506 2.56 1.57 1.57 0 0 0 1.113.457Z"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
</svg>);

export default IconEmbed;
