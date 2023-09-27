import * as React from "react";

const IconMenu = (
	{
		stroke = "var(--main)",
		strokeWidth = "1.5",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
		   stroke={stroke}
		   strokeWidth={strokeWidth}
		   {...props}>
	<path d="M4 12H20" stroke={stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M4 6H20" stroke={stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M4 18H20" stroke={stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>);

export default IconMenu;
