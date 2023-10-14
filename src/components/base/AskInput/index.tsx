import React from "react";
import { useEnterSubmit } from "hooks/useEnterSubmit";
import Input from "../Input";
import IconSend from "../Icon/IconSend";

export interface AskInputProps {
	onSubmit: (value: string) => Promise<void>
	input: string,
	setInput: (value: string) => void,
	isLoading: boolean,
	contextMessage: string,
}

const AskInput = ({
	onSubmit, input, setInput, isLoading, contextMessage, ...inputProps
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
				placeholder={`Ask to ${contextMessage}`}
			/>
		</form>

	);
};

export default AskInput;
