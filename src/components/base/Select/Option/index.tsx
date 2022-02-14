import React, { useContext } from "react";
import cc from "classcat";
import SelectContext from "../select-context";

export interface OptionProps {
	value: string;
	children: React.ReactNode;
	divider?: boolean;
	size?: "sm" | "md" | "lg",
}

const Option: React.FC<OptionProps> = ({
	value,
	children,
	divider = false,
	size = "md",
}) => {
	const selectContext = useContext(SelectContext);

	const getSelected = () => (selectContext && selectContext.getSelected ? selectContext.getSelected(value) : false);

	const handleSelected = () => {
		selectContext && selectContext.setValueFromOption && selectContext.setValueFromOption(value);
	};

	return (
		<div
			className={cc([
				"idx-option",
				getSelected() ? "idx-option-selected" : "",
				divider ? "idx-option-divider" : "",
				`idx-option-${size}`,
			])}
			onClick={handleSelected}
		>
			{children}
		</div>);
};

export default Option;
