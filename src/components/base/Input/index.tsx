import React, { useState } from "react";
import cc from "classcat";
import { InputSizeType, PropType } from "types";
import Flex from "layout/base/Grid/Flex";
import IconVisible from "../Icon/IconVisible";
import IconInvisible from "../Icon/IconInvisible";

export interface InputProps extends React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> {
	error?: string;
	inputSize?: InputSizeType;
	block?: boolean;
	addOnBefore?: React.ReactNode;
	addOnAfter?: React.ReactNode;
	type?: PropType<React.InputHTMLAttributes<HTMLInputElement>, "type">;
}

const Input: React.FC<InputProps> = ({
	className,
	addOnBefore,
	addOnAfter,
	disabled,
	readOnly,
	type,
	block = true,
	inputSize = "md",
	...inputProps
}) => {
	const [showPw, setShowPw] = useState(false);

	const handleTogglePw = () => {
		setShowPw((oldVal) => !oldVal);
	};
	const renderVisible = () => (showPw ? <IconInvisible onClick={handleTogglePw} /> : <IconVisible onClick={handleTogglePw} />);

	return (
		<Flex className={cc(
			[
				"idx-input",
				`idx-input-${inputSize}`,
				block ? "idx-input-block" : "",
				disabled ? "idx-input-disabled" : "",
				readOnly ? "idx-input-readonly" : "",
				addOnBefore ? "idx-input-add-on-before" : "",
				addOnAfter ? "idx-input-add-on-after" : "",
				className,
			],
		)}>
			{addOnBefore}
			<input
				{...inputProps}
				disabled={disabled}
				readOnly={readOnly}
				type={type === "password" && showPw ? "text" : type}
				className={"idx-input__input"} />
			{type === "password" ? renderVisible() : addOnAfter}
		</Flex>
	);
};
export default Input;
