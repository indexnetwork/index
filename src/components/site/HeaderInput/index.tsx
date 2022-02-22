import Input, { InputProps } from "components/base/Input";
import React from "react";
import { HeaderSizeType } from "types";
import cc from "classcat";

export interface HeaderInputProps extends InputProps {
	size?: HeaderSizeType;
}

const HeaderInput: React.VFC<HeaderInputProps> = ({ size = 3, ...inputProps }) => <Input
	inputSize="sm"
	className={cc([
		"header-input",
		`header-input-${size}`,
	])}
	{...inputProps} />;

export default HeaderInput;
