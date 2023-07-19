import React, { useState } from "react";
import Input, { InputProps } from "../Input";
import IconSend from "../Icon/IconSend";

export interface AskInputProps extends InputProps {
	onEnter: (value: string) => void;
}

const AskInput = ({ onEnter, ...inputProps }: AskInputProps) => {
	const [inputValue, setInputValue] = useState("");

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			onEnter(inputValue);
		}
	};

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(event.target.value);
	};

	return (
		<Input
			{...inputProps}
			value={inputValue}
			inputSize={"lg"}
			addOnAfter={<IconSend width={20} height={20} />}
			onKeyDown={handleKeyDown}
			onChange={handleChange}
		/>
	);
};

export default AskInput;
