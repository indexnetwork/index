import * as React from "react";

const IconTelegram = (
	{
		fill = "white",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg className="icon"
	width={32}
	height={32}
	viewBox="0 0 32 32"
	xmlns="http://www.w3.org/2000/svg"
	fill={"none"}
	{...props}
>
	<path d="M16 0a16 16 0 1 0 0 32 16 16 0 0 0 0-32Z" fill={fill} />
	<path
		d="m23.96 8.8-2.997 15.3s-.129.7-.996.7c-.46 0-.698-.22-.698-.22l-6.492-5.386-3.176-1.6-4.076-1.084S4.8 16.3 4.8 15.7c0-.5.746-.738.746-.738L22.6 8.187s.52-.188.9-.187c.234 0 .5.1.5.4 0 .2-.04.4-.04.4Z"
		fill="#7F7F7F"
	/>
	<path
		d="m15.2 21.204-2.74 2.7s-.12.091-.279.095a.395.395 0 0 1-.175-.034l.771-4.772 2.423 2.011Z"
		fill="#B0BEC5"
	/>
	<path
		d="M20.717 11.357a.4.4 0 0 0-.56-.074L9.6 17.6s1.684 4.714 1.941 5.53c.258.817.464.836.464.836l.771-4.772 7.866-7.277a.4.4 0 0 0 .075-.56Z"
		fill="#CFD8DC"
	/>
</svg>);

export default IconTelegram;
