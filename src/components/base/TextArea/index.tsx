import React, { useRef, useState } from "react";
import cc from "classcat";
import { InputSizeType, PropType } from "types";
import Flex from "components/layout/base/Grid/Flex";
import IconVisible from "../Icon/IconVisible";
import IconInvisible from "../Icon/IconInvisible";

export interface TextAreaProps extends React.DetailedHTMLProps<React.TextareaHTMLAttributes<HTMLTextAreaElement>, HTMLTextAreaElement> {
	error?: string;
	inputSize?: InputSizeType;
	block?: boolean;
	ghost?: boolean;
	addOnBefore?: React.ReactNode;
	addOnAfter?: React.ReactNode;
	type?: PropType<React.InputHTMLAttributes<HTMLInputElement>, "type">;
}

const TextArea: React.FC<TextAreaProps> = ({
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
}) => {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [showPw, setShowPw] = useState(false);

	const handleTogglePw = () => {
		setShowPw((oldVal) => !oldVal);
	};
	const renderVisible = () => (showPw ? <IconInvisible onClick={handleTogglePw} /> : <IconVisible onClick={handleTogglePw} />);

	return (
		<Flex className={cc(
			[
				"idx-textarea",
				`idx-textarea-${inputSize}`,
				ghost ? "idx-textarea-ghost" : "",
				block ? "idx-textarea-block" : "",
				disabled ? "idx-textarea-disabled" : "",
				readOnly ? "idx-textarea-readonly" : "",
				className,
			],
		)}>
			{addOnBefore}
			<textarea
				ref={inputRef}
				{...inputProps}
				disabled={disabled}
				readOnly={readOnly}
				rows={rows}
				className={"idx-textarea__textarea"} />
			{type === "password" ? renderVisible() : addOnAfter}
		</Flex>
	);
};
export default TextArea;
