import * as React from "react";

const LogoMini: React.FC<React.SVGProps<SVGSVGElement>> = ({ fill = "var(--ias-main)", ...props }) => (
	<svg className="idx-icon"
		width={20}
		height={32}
		viewBox="0 0 20 32"
		fill={fill}
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path
			d="M12.768 6.332v19.34H6.362V6.332h6.406L6.436 0H0v19.31L12.69 32h6.437V12.69l-6.36-6.358Z"
		/>
	</svg>
);

export default LogoMini;
