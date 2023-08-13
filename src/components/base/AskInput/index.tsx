import React from "react";
import Input from "../Input";
import IconSend from "../Icon/IconSend";
import { useEnterSubmit } from "../../../hooks/useEnterSubmit";

export interface AskInputProps {
	onSubmit: (value: string) => Promise<void>
	input: string,
	setInput: (value: string) => void,
	isLoading: boolean,
}

const AskInput = ({
	onSubmit, input, setInput, isLoading, ...inputProps
}: AskInputProps) => {
	const { formRef, onKeyDown } = useEnterSubmit();
	const inputRef = React.useRef<HTMLInputElement>(null);
	return (
		<form
			onSubmit={async (e) => {
				e.preventDefault();
				if (!input?.trim()) {
					return;
				}
				setInput("");
				await onSubmit(input);
			}}
			ref={formRef}
		>
			<Input
				ref={inputRef}
				value={input}
				onKeyDown={onKeyDown}
				onChange={(e) => setInput(e.target.value)}
				inputSize={"lg"}
				addOnAfter={<IconSend cursor="pointer" onClick={async () => {
					if (!input?.trim()) {
						return;
					}
					setInput("");
					await onSubmit(input);
				}} width={20} height={20} />}
				spellCheck={false}
				placeholder={"Ask to your indexes"}
			/>
		</form>

	);
};

export default AskInput;
