import * as React from "react";

const IconContextMenu = (
	{
		stroke = "var(--gray-4)",
		fill = "var(--gray-4)",
		strokeWidth = ".1",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg
	width="20"
	height="20"
	viewBox="0 0 20 20"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<g clipPath="url(#clip0_9904_23124)">
		<path
			d="M3.50039 12.5374C4.62567 12.5374 5.53789 11.6252 5.53789 10.4999C5.53789 9.37462 4.62567 8.4624 3.50039 8.4624C2.37511 8.4624 1.46289 9.37462 1.46289 10.4999C1.46289 11.6252 2.37511 12.5374 3.50039 12.5374Z"
			fill="#2A2A2A"
		/>
		<path
			d="M10.0004 12.5374C11.1257 12.5374 12.0379 11.6252 12.0379 10.4999C12.0379 9.37462 11.1257 8.4624 10.0004 8.4624C8.87511 8.4624 7.96289 9.37462 7.96289 10.4999C7.96289 11.6252 8.87511 12.5374 10.0004 12.5374Z"
			fill="#2A2A2A"
		/>
		<path
			d="M16.5004 12.5374C17.6257 12.5374 18.5379 11.6252 18.5379 10.4999C18.5379 9.37462 17.6257 8.4624 16.5004 8.4624C15.3751 8.4624 14.4629 9.37462 14.4629 10.4999C14.4629 11.6252 15.3751 12.5374 16.5004 12.5374Z"
			fill="#2A2A2A"
		/>
	</g>
	<defs>
		<clipPath id="clip0_9904_23124">
			<rect
				width="17.075"
				height="4.075"
				fill="white"
				transform="translate(1.46289 8.4624)"
			/>
		</clipPath>
	</defs>
</svg>);

export default IconContextMenu;
