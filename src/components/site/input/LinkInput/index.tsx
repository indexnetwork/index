import Input, { InputProps } from "components/base/Input";
import React from "react";
import { HeaderSizeType } from "types";
import cc from "classcat";
import IconAdd from "components/base/Icon/IconAdd";

export interface LinkInputProps extends InputProps {
	size?: HeaderSizeType;
}

const LinkInput: React.VFC<LinkInputProps> = ({ size = 3, ...inputProps }) => (
	<div className="link-input">
		<Input
			inputSize="sm"
			className={cc([
				"link-input__input",
				`link-input-${size}`,
			])}
			addOnBefore={<IconAdd width={12} height={12} />}
			{...inputProps} />
	</div>
);

export default LinkInput;
