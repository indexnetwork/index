import * as React from "react";

const IconEdit = (
	{
		stroke = "var(--main)",
		strokeWidth = "1.2",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg
	width="12"
	height="12"
	viewBox="0 0 12 12"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<g clipPath="url(#clip0_9836_46550)">
		<path
			d="M7.5 2.10557L1.14981 8.45576L0.75 11.25L3.54424 10.8502L9.89443 4.5M7.5 2.10557L8.33458 1.27099C8.75924 0.828442 9.39001 0.650103 9.98353 0.804773C10.5771 0.959444 11.0406 1.42295 11.1952 2.01647C11.3499 2.60999 11.1716 3.24076 10.729 3.66542L9.89443 4.5M7.5 2.10557L9.89443 4.5"
			stroke="#3F3F3F"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</g>
	<defs>
		<clipPath id="clip0_9836_46550">
			<rect width="12" height="12" fill="white" />
		</clipPath>
	</defs>
</svg>);

export default IconEdit;
