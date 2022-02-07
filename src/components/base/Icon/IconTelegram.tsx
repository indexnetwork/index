import * as React from "react";

const IconTelegram: React.FC<React.SVGProps<SVGSVGElement>> = ({ fill = "var(--main)", ...props }) => (
	<svg
		width={24}
		height={24}
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		fill={fill}
		{...props}
	>
		<path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Z" />
		<path
			d="m17.97 6.6-2.247 11.476s-.097.524-.748.524c-.345 0-.523-.164-.523-.164l-4.869-4.04-2.382-1.2-3.057-.814s-.544-.157-.544-.607c0-.375.56-.554.56-.554l12.79-5.08c-.001-.001.39-.142.675-.141.175 0 .375.075.375.3 0 .15-.03.3-.03.3Z"
			fill="#fff"
		/>
		<path
			d="m11.4 15.903-2.055 2.025s-.09.069-.209.072a.296.296 0 0 1-.131-.026l.578-3.58 1.818 1.51Z"
			fill="#B0BEC5"
		/>
		<path
			d="M15.538 8.517a.3.3 0 0 0-.42-.055L7.2 13.2s1.264 3.535 1.456 4.147c.194.613.348.627.348.627l.579-3.579 5.899-5.458a.3.3 0 0 0 .056-.42Z"
			fill="#CFD8DC"
		/>
	</svg>
);

export default IconTelegram;
