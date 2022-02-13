import React, {
	ReactElement, useEffect, useState,
} from "react";
import cc from "classcat";
import { SelectValueType } from "types";
import SelectContext from "./select-context";
import { OptionProps } from "./Option";

export type SelectChildrenType = ReactElement<OptionProps>[] | ReactElement<OptionProps>;

export interface SelectProps {
	children: SelectChildrenType;
	value?: string | string[];
	defaultValue?: SelectValueType;
	mode?: "single" | "multiple";
	onChange?(value?: string | string[]): void;
}

const Select: React.VFC<SelectProps> = ({
	children,
	value,
	mode = "single",
	onChange,
}) => {
	const loadState = () => {
		if (mode === "multiple") {
			return value || [];
		}
		return value;
	};

	const [selection, setSelection] = useState<string | string[] | undefined>(() => loadState());

	const getSelected = (optionValue: string) => (mode === "single" ? selection === optionValue : (selection! as string[]).indexOf(optionValue) > -1);

	useEffect(() => {
		setSelection(loadState);
	}, [value]);

	const handleValueChange = (optionValue: string) => {
		if (mode === "single") {
			setSelection(optionValue);
			return;
		}

		const selectedBefore = getSelected(optionValue);
		if (selectedBefore) {
			setSelection((oldSelection) => (oldSelection as string[]).filter((val) => val !== optionValue));
		} else {
			setSelection((oldSelection) => [...(oldSelection as string[]), optionValue]);
		}
	};

	useEffect(() => {
		onChange && onChange(selection!);
	}, [selection]);

	const getMode = () => mode;

	const renderInputItem = (child: ReactElement<OptionProps>) => {
		const hasItem = getSelected(child.props.value);
		if (!hasItem) {
			return null;
		}
		return (
			<div
				className="idx-select-input-item"
			>
				{child.props.children}
			</div>
		);
	};

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
				<div
					className={cc([
						"idx-select",
						mode === "multiple" ? "idx-select-multiple" : "",
					])}
				>
					<div className="idx-select-input">
						{
							React.Children.map(children, (child) => renderInputItem(child))
						}
						<div
							className="idx-select-input-down"
						>
						</div>
					</div>
					<div className="idx-select-menu">
						{children}
					</div>
				</div>
			</SelectContext.Provider>
		</div>
	);
};
Select.defaultProps;
export default Select;
