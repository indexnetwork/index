import * as React from "react";

const IconAlertCircle: React.FC<React.SVGProps<SVGSVGElement>> = ({ ...props }) => (
	<svg className="icon"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		xmlSpace="preserve"
		{...props}
	>
		<circle cx={12} cy={16.875} r={1.125} />
		<path d="M12 14.25a.75.75 0 0 1-.75-.75V5.25a.75.75 0 0 1 1.5 0v8.25a.75.75 0 0 1-.75.75z" />
		<path d="M12 24C5.383 24 0 18.617 0 12S5.383 0 12 0s12 5.383 12 12-5.383 12-12 12zm0-22.5C6.21 1.5 1.5 6.21 1.5 12S6.21 22.5 12 22.5 22.5 17.79 22.5 12 17.79 1.5 12 1.5z" />
	</svg>
);

export default IconAlertCircle;
