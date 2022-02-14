import React, {
	ReactElement, useEffect, useRef, useState,
} from "react";
import cc from "classcat";
import { SelectValueType } from "types";
import useBackdropClick from "hooks/useBackdropClick";
import SelectContext from "./select-context";
import { OptionProps } from "./Option";
import IconUpArrow from "../Icon/IconUpArrow";
import IconClose from "../Icon/IconClose";

export type SelectChildrenType = ReactElement<OptionProps>[] | ReactElement<OptionProps>;

export interface SelectProps {
	children: SelectChildrenType;
	value?: string | string[];
	defaultValue?: SelectValueType;
	mode?: "single" | "multiple";
	bordered?: boolean;
	size?: "sm" | "md" | "lg",
	fullWidth?: boolean;
	disabled?: boolean;
	placeholder?: React.ReactNode;
	onChange?(value?: string | string[]): void;
}

const Select: React.VFC<SelectProps> = ({
	children,
	value,
	bordered,
	mode = "single",
	size = "md",
	fullWidth = true,
	disabled = false,
	placeholder,
	onChange,
}) => {
	const loadState = () => {
		if (mode === "multiple") {
			return typeof value === "undefined" ? [] : (typeof value === "string" ? [value] : [...(value! as string[])]);
		}
		return value;
	};

	const [menuOpen, setMenuOpen] = useState(false);

	const selectRef = useRef<HTMLDivElement>(null);

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

	const showPlaceholder = (): boolean => {
		if (placeholder) {
			if (mode === "single") {
				return !selection;
			}
			return !selection || (selection as string[]).length === 0;
		}
		return false;
	};

	useEffect(() => {
		onChange && onChange(selection!);
	}, [selection]);

	const getMode = () => mode;

	const handleToggle = () => {
		setMenuOpen((oldVal) => !oldVal);
	};

	const handleBackdropClick = () => {
		setMenuOpen(false);
	};

	useBackdropClick(selectRef, handleBackdropClick, menuOpen);

	const handleRemoveSelection = (e: any, optionValue: string) => {
		e && e.stopPropagation();
		setSelection((oldSelection) => (oldSelection as string[]).filter((val) => val !== optionValue));
	};

	const renderInputItem = (child: ReactElement<OptionProps>) => {
		const hasItem = getSelected(child.props.value);
		if (!hasItem) {
			return null;
		}
		return (
			<div
				className="idx-select-input-item"
				onClick={mode === "multiple" && !disabled ? (e) => handleRemoveSelection(e, child.props.value) : undefined}
			>
				{child.props.children}
				{mode === "multiple" && <IconClose className="idx-select-multiple-close-icon"/>}
			</div>
		);
	};

	return (
		<SelectContext.Provider
			value={{
				selection,
				setValueFromOption: handleValueChange,
				getSelected,
				getMode,
			}}
		>
			<div
				ref={selectRef}
				className={cc([
					"idx-select",
					mode === "multiple" ? "idx-select-multiple" : "",
					bordered ? "idx-select-bordered" : "",
					menuOpen ? "idx-select-open" : "",
					disabled ? "idx-select-disabled" : "",
					fullWidth ? "idx-w-100" : "",
				])}
			>
				<div
					className={cc([
						"idx-select-input",
						`idx-select-input-${size}`,
					])}
					onClick={!disabled ? handleToggle : undefined}
				>
					<div className="idx-select-selections">
						{
							React.Children.map(children, (child) => renderInputItem(child))
						}
						{showPlaceholder() && <div className="idx-select-placeholder">{placeholder}</div>}
					</div>
					<IconUpArrow className="idx-select-input-arrow" />
				</div>
				<div className="idx-select-menu">
					{children}
				</div>
			</div>
		</SelectContext.Provider>
	);
};

export default Select;
