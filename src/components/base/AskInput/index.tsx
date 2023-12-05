import React from "react";
import { useEnterSubmit } from "hooks/useEnterSubmit";
import IconSend from "../Icon/IconSend";
import TextArea from "../TextArea";

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
	const inputRef = React.useRef<HTMLTextAreaElement>(null);
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
			<TextArea
				ref={inputRef}
				value={input}
				rows={1}
				maxRows={8}
				onKeyDown={onKeyDown}
				onChange={(e) => setInput(e.target.value)}
				inputSize={"md"}
				addOnAfter={<IconSend className="add-on-after-icon" cursor="pointer" onClick={async () => {
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
