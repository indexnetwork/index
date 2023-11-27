import React, { useRef, useState } from "react";
import cc from "classcat";
import { InputSizeType, PropType } from "types";
import Flex from "components/layout/base/Grid/Flex";
import TextareaAutosize, {
	TextareaAutosizeProps,
  } from "react-textarea-autosize";
import IconVisible from "../Icon/IconVisible";
import IconInvisible from "../Icon/IconInvisible";

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, TextareaAutosizeProps {
	error?: string;
	inputSize?: InputSizeType;
	block?: boolean;
	ghost?: boolean;
	addOnBefore?: React.ReactNode;
	addOnAfter?: React.ReactNode;
	type?: PropType<React.InputHTMLAttributes<HTMLInputElement>, "type">;
}

const TextArea = (
	{
		className,
		addOnBefore,
		addOnAfter,
		disabled,
		readOnly,
		type,
		block = true,
		ghost = false,
		inputSize = "md",
		rows = 6,
		...inputProps
	}: TextAreaProps,
) => {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [showPw, setShowPw] = useState(false);

	const handleTogglePw = () => {
		setShowPw((oldVal) => !oldVal);
	};
	const renderVisible = () => (showPw ? <IconInvisible onClick={handleTogglePw} /> : <IconVisible onClick={handleTogglePw} />);

	return (
		<Flex className={cc(
			[
				"textarea",
				`textarea-${inputSize}`,
				ghost ? "textarea-ghost" : "",
				block ? "textarea-block" : "",
				disabled ? "textarea-disabled" : "",
				readOnly ? "textarea-readonly" : "",
				className,
			],
		)}>
			{addOnBefore}
			<TextareaAutosize
				ref={inputRef}
				{...inputProps}
				disabled={disabled}
				readOnly={readOnly}
				rows={rows}
				className={"textarea__textarea"} />
			{type === "password" ? renderVisible() : addOnAfter}
		</Flex>
	);
};
export default TextArea;
