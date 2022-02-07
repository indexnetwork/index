import * as React from "react";

const IconTrash: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--error)", strokeWidth = "1.2", ...props }) => (
	<svg
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
			d="M12.212 4.93v8.567c0 .31-.125.607-.348.825a1.2 1.2 0 0 1-.841.343H4.97a1.2 1.2 0 0 1-.841-.342 1.157 1.157 0 0 1-.349-.826V4.929M6.614 2.994V1.819a.476.476 0 0 1 .146-.344.493.493 0 0 1 .353-.14h1.774c.13 0 .256.051.349.142a.48.48 0 0 1 .144.342v1.175M2.829 2.994h10.343M2.829 4.555h10.343M6.614 6.639v5.845M9.38 6.639v5.845"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconTrash;
