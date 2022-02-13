import React, { useContext } from "react";
import cc from "classcat";
import SelectContext from "../select-context";

export interface OptionProps {
	value: string;
	children: React.ReactNode;
}

const Option: React.FC<OptionProps> = ({
	value,
	children,
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
			])}
			onClick={handleSelected}
			style={getSelected() ? { color: "red" } : undefined}
		>
			{children}
		</div>);
};

export default Option;
