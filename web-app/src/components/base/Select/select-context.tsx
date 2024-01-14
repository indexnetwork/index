import React from "react";

export interface SelectContextType {
	readonly selection?: string | string[];
	setValueFromOption?(value: string): void;
	getSelected?(value: string): boolean;
	getMode?(): "single" | "multiple";
}

const SelectContext = React.createContext<SelectContextType>({});

export default SelectContext;
