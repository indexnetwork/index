import * as React from "react";

const IconVisible = (
	{
		stroke = "var(--gray-4)",
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
		clipRule="evenodd"
		d="M8 9.953a1.979 1.979 0 1 0 0-3.957 1.979 1.979 0 0 0 0 3.957Z"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
	<path
		clipRule="evenodd"
		d="M14.43 7.789C13.774 7.043 11.145 4.3 8 4.3c-3.144 0-5.773 2.743-6.43 3.489a.283.283 0 0 0 0 .37c.657.747 3.286 3.49 6.43 3.49 3.144 0 5.773-2.743 6.43-3.49a.283.283 0 0 0 0-.37Z"
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
</svg>);

export default IconVisible;
