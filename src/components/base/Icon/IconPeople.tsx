import * as React from "react";

const IconPeople: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--main)", strokeWidth = ".3", ...props }) => (
	<svg className="idx-icon"
		width={16}
		height={16}
		viewBox="0 0 16 16"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<path
			d="M1.5 14a.5.5 0 0 0 1 0h-1Zm12 0a.5.5 0 0 0 1 0h-1Zm-11 0c0-1.805.892-3.04 2.037-3.84C5.7 9.346 7.099 9 8 9V8c-1.099 0-2.7.404-4.037 1.34C2.608 10.29 1.5 11.805 1.5 14h1ZM8 9c1.132 0 2.524.459 3.628 1.33 1.094.864 1.872 2.104 1.872 3.67h1c0-1.934-.972-3.444-2.253-4.455C10.977 8.541 9.368 8 8 8v1Z"
		/>
		<path
			d="M11.25 4.75A3.25 3.25 0 0 1 8 8v1a4.25 4.25 0 0 0 4.25-4.25h-1ZM8 8a3.25 3.25 0 0 1-3.25-3.25h-1A4.25 4.25 0 0 0 8 9V8ZM4.75 4.75A3.25 3.25 0 0 1 8 1.5v-1a4.25 4.25 0 0 0-4.25 4.25h1ZM8 1.5a3.25 3.25 0 0 1 3.25 3.25h1A4.25 4.25 0 0 0 8 .5v1Z"
		/>
	</svg>
);

export default IconPeople;
