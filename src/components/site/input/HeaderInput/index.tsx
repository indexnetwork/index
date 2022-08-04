import Input, { InputProps } from "components/base/Input";
import React from "react";
import { HeaderSizeType } from "types";
import cc from "classcat";
import Spin from "components/base/Spin";

export interface HeaderInputProps extends InputProps {
	size?: HeaderSizeType;
	loading?: boolean;
}

const HeaderInput: React.VFC<HeaderInputProps> = ({ size = 3, loading, ...inputProps }) => <Input
	inputSize="sm"
	addOnAfter={loading && (<Spin active={true} thickness="light" theme="secondary" />)}
	className={cc([
		"header-input",
		`header-input-${size}`,
	])}
	{...inputProps} />;

export default HeaderInput;
