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
