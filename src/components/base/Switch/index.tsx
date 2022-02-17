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

const Switch: React.FC<SwitchProps> = ({
	checked = true,
	size = "sm",
	theme = "primary",
	disabled = false,
	onChange,
}) => {
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
			"idx-switch",
			`idx-switch-${theme}`,
			`idx-switch-${size}`,
			disabled ? "idx-switch-disabled" : "",
			active ? "idx-switch-checked" : "",
		])}
		disabled={disabled}
		onClick={handleChange}
	>
		<div className="idx-switch-knob">
		</div>
	</button>);
};

export default Switch;
