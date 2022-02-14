import Flex from "layout/base/Grid/Flex";
import React, { useEffect, useState } from "react";
import cc from "classcat";
import Text from "../Text";
import IconTick from "../Icon/IconTick";

export interface CheckboxProps {
	title: string;
	checked?: boolean;
	disabled?: boolean;
	children?: never;
	size?: "sm" | "md" | "lg";
	onChange?(checked: boolean): void;
}

const Checkbox: React.VFC<CheckboxProps> = ({
	checked = false,
	disabled,
	title,
	onChange,
	size = "md",
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
				"idx-checkbox",
				`idx-checkbox-${size}`,
				isChecked ? "idx-checkbox-checked" : "",
				disabled ? "idx-checkbox-disabled" : "",
			])}
		>
			<Text
				element="label"
				className="idx-checkbox-container"
				theme={disabled ? "disabled" : "primary"}
			>
				<input
					type="checkbox"
					checked={isChecked}
					disabled={disabled}
					className="idx-checkbox-input"
					onChange={handleChange}
				/>
				<span className="idx-checkbox-checkmark idx-checkbox-checkmark-md">
					{isChecked && <IconTick className="idx-checkbox-tick" />}
				</span>
				{title}
			</Text>
		</Flex>
	);
};

export default Checkbox;
