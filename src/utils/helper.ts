import moment from "moment";

export function copyToClipboard(str?: string) {
	if (navigator && navigator.clipboard) navigator.clipboard.writeText(str || "");
	else {
		const temp = document.createElement("input");
		const newStyle: Partial<CSSStyleDeclaration> =
    {
    	position: "absolute",
    	left: "-5000px",
    	top: "-5000px",
    };

		Object.assign(temp.style, {
			newStyle,
		});
		temp.value = str || "";
		document.body.appendChild(temp);
		temp.select();
		document.execCommand("copy");
		document.body.removeChild(temp);
	}
}

export function generateRandomColor() {
	const hue = Math.floor(Math.random() * 360);
	return `hsl(${hue}, 50%, 50%)`;
}

export function isSSR() {
	return !(
		typeof window !== "undefined" &&
			window.document &&
			window.document.createElement
	);
}

export function maskAddress(address: string) {
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isMobile() {
	return !isSSR() && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
export const setDates = <T extends { updated_at?: string, created_at?: string, [key: string]: any }>(obj: T, update: boolean = false) => {
	const date = moment.utc().toISOString();
	if (update === false) {
		obj.created_at = date;
	}
	obj.updated_at = date;
	return obj;
};

export const getCurrentDateTime = () => moment.utc().toISOString();
