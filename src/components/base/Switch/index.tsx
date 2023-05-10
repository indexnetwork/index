import { InputSizeType, TextThemeType } from "types";
import cc from "classcat";
import { useEffect, useState } from "react";

export interface SwitchProps {
	checked?: boolean;
	size?: InputSizeType;
	theme?: TextThemeType;
	disabled?: boolean;
	onChange?(checked: boolean): void;
}

const Switch = (
	{
		checked = true,
		size = "sm",
		theme = "primary",
		disabled = false,
		onChange,
	}: SwitchProps,
) => {
	const [active, setActive] = useState(checked);

	useEffect(() => {
		setActive(checked);
	}, [checked]);

	useEffect(() => {
		onChange && onChange(active);
	}, [onChange, active]);

	const handleChange = () => {
		setActive((oldActive) => !oldActive);
	};

	return (<button
		className={cc([
			"switch",
			`switch-${theme}`,
			`switch-${size}`,
			disabled ? "switch-disabled" : "",
			active ? "switch-checked" : "",
		])}
		disabled={disabled}
		onClick={handleChange}
	>
		<div className="switch-knob">
		</div>
	</button>);
};

export default Switch;
