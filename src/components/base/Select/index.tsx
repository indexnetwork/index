import React, { ReactElement, useEffect, useState } from "react";
import cc from "classcat";
import { SelectValueType, SingleOptionValue } from "types";
import SelectContext from "./select-context";
import { OptionProps } from "./Option";

export type SelectChildrenType = ReactElement<OptionProps>[] | ReactElement<OptionProps>;

export interface SelectProps {
	children: SelectChildrenType;
	value?: SelectValueType;
	defaultValue?: SelectValueType;
	mode?: "single" | "multiple";
	onChange?(value: SelectValueType): void;
}

const Select: React.VFC<SelectProps> = ({
	children,
	value,
	defaultValue,
	mode = "single",
	onChange,
}) => {
	const [selection, setSelection] = useState<SelectValueType>(() => {
		if (value) {
			return value;
		}
		return defaultValue;
	});

	const handleValueChange = (optionValue: SingleOptionValue, selected: boolean) => {
		if (mode === "multiple") {
			setSelection((oldSelection) => {
				if (oldSelection && !(typeof oldSelection === "string" || typeof oldSelection === "number")) {
					if (selected) {
						return [...oldSelection, optionValue];
					}
					return (oldSelection as any).filter((opt: SingleOptionValue) => opt !== optionValue);
				}
				return [optionValue];
			});
		} else {
			setSelection(optionValue);
		}
	};

	const getSelected = (optionValue: SingleOptionValue) => {
		if (mode === "multiple") {
			if (selection && !(typeof selection === "string" || typeof selection === "number")) {
				return (selection as any).indexOf(optionValue) > -1;
			}
			return false;
		}
		return selection === optionValue;
	};

	const getMode = () => mode;

	useEffect(() => {
		setSelection(value);
	}, [value]);

	useEffect(() => {
		onChange && onChange(selection);
	}, [selection]);

	return (
		<div
			className={cc([
				"idx-select",
			])}
		>
			<SelectContext.Provider
				value={{
					selection,
					setValueFromOption: handleValueChange,
					getSelected,
					getMode,
				}}
			>
				{children}
			</SelectContext.Provider>
		</div>
	);
};
Select.defaultProps;
export default Select;
