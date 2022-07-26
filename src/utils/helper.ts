import moment from "moment";
import { Links } from "types/entity";
import { v4 as uuid } from "uuid";

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

export function isMobile() {
	return !isSSR() && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
export const setDates = <T extends { updatedAt?: string, createdAt?: string, [key: string]: any }>(obj: T, update: boolean = false) => {
	const date = moment.utc().toISOString();
	if (update === false) {
		obj.createdAt = date;
	}
	obj.updatedAt = date;
	return obj;
};

export function prepareLinks(links: Links[], update: boolean = false) {
	return links?.map((link) => setDates({
		...link,
		id: uuid(),
	}, update));
}
export function arrayMove(list: any[], startIndex: number, endIndex: number) {
	const result = Array.from(list);
	const [removed] = result.splice(startIndex, 1);
	result.splice(endIndex, 0, removed);
	return result;
}
