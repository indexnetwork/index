import React, { useContext, useEffect, useState } from "react";
import cc from "classcat";
import { SingleOptionValue } from "types";
import SelectContext from "../select-context";

export interface OptionProps {
	value: SingleOptionValue;
}

const Option: React.FC<OptionProps> = ({
	value,
	children,
}) => {
	const selectContext = useContext(SelectContext);

	const getSelected = () => (selectContext && selectContext.getSelected ? selectContext.getSelected(value) : false);

	const [selected, setSelected] = useState<boolean>(() => getSelected());

	const handleSelected = () => {
		setSelected((prevSelected) => !prevSelected);
	};

	useEffect(() => {
		if (selected || (selectContext && selectContext.getMode && selectContext.getMode() === "multiple")) {
			selectContext && selectContext.setValueFromOption && selectContext.setValueFromOption(value, selected);
		}
	}, [
		selected,
	]);

	return (
		<div
			className={cc([
				"idx-option",
				selected ? "idx-option-selected" : "",
			])}
			onClick={handleSelected}
			style={getSelected() ? { color: "red" } : undefined}
		>
			{children}
		</div>);
};

export default Option;
