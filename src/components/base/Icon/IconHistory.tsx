import * as React from "react";

const IconHistory = (
	{
		stroke = "var(--main)",
		strokeWidth = "1.5",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg width={24}
	height={24}
	stroke={stroke}
	strokeWidth={strokeWidth}
	{...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
	<path d="M3 3V8H8" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
	<path d="M3.05 13C3.27151 15.0058 4.1607 16.879 5.57478 18.3187C6.98886 19.7584 8.84577 20.681 10.8473 20.9385C12.8488 21.196 14.8788 20.7734 16.6112 19.7384C18.3436 18.7035 19.678 17.1164 20.3999 15.2319C21.1219 13.3475 21.1896 11.2751 20.5921 9.34754C19.9947 7.42 18.7668 5.74918 17.1056 4.60341C15.4444 3.45764 13.4463 2.90342 11.4322 3.02974C9.41817 3.15607 7.50501 3.95561 6 5.29997L3 7.99997" stroke="black" strokeWidth="2" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M12 7V12L16 14" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
</svg>);

export default IconHistory;
