import * as React from "react";

const IconSort = (
	{
		stroke = "var(--gray-4)",
		strokeWidth = "1.2",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg
	width="20"
	height="20"
	viewBox="0 0 20 20"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<path
		d="M9.66016 7.64569L13.9609 2.45215L18.2713 7.64569"
		stroke="#2A2A2A"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
	<path
		d="M13.9609 17.548V2.45215"
		stroke="#2A2A2A"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
	<path
		d="M10.3401 12.3545L6.03935 17.548L1.729 12.3545"
		stroke="#2A2A2A"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
	<path
		d="M6.03906 17.548V2.45215"
		stroke="#2A2A2A"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
</svg>);

export default IconSort;
