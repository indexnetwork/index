import React from "react";
import { SelectValueType, SingleOptionValue } from "types";

export interface SelectContextType {
	readonly selection?: SelectValueType;
	setValueFromOption?(value: SingleOptionValue, selected: boolean): void;
	getSelected?(value: SingleOptionValue): boolean;
	getMode?(): "single" | "multiple";
}

const SelectContext = React.createContext<SelectContextType>({});

export default SelectContext;
