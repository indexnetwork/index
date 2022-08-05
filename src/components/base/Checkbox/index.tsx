import Flex from "components/layout/base/Grid/Flex";
import React, { useEffect, useState } from "react";
import cc from "classcat";
import { InputSizeType, TextThemeType } from "types";
import Text from "../Text";
import IconTick from "../Icon/IconTick";

export interface CheckboxProps {
	title: string;
	checked?: boolean;
	disabled?: boolean;
	size?: InputSizeType;
	theme?: TextThemeType;
	onChange?(checked: boolean): void;
}

const Checkbox: React.VFC<CheckboxProps> = ({
	checked = false,
	disabled,
	title,
	onChange,
	size = "md",
	theme = "gray5",
}) => {
	const [isChecked, setIsChecked] = useState(checked);

	useEffect(() => {
		setIsChecked(!!(checked));
	}, [checked]);

	const handleChange = (e: any) => {
		if (!disabled && e && e.target) {
			setIsChecked(!!e.target.checked);
			onChange && onChange(!!e.target.checked);
		}
	};

	return (
		<Flex
			alignItems="center"
			className={cc([
				"cbx",
				`cbx-${size}`,
				isChecked ? "cbx-checked" : "",
				disabled ? "cbx-disabled" : "",
			])}
		>
			<Text
				element="label"
				size="sm"
				className="cbx-container"
				theme={disabled ? "disabled" : theme}
			>
				<input
					type="checkbox"
					checked={isChecked}
					disabled={disabled}
					className="cbx-input"
					onChange={handleChange}
				/>
				<span className="cbx-checkmark cbx-checkmark-md">
					{isChecked && <IconTick className="cbx-tick" />}
				</span>
				{title}
			</Text>
		</Flex>
	);
};

export default Checkbox;
