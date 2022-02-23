import Select, { SelectProps } from "components/base/Select";
import Option from "components/base/Select/Option";
import Text from "components/base/Text";
import React from "react";
import { UserRightType } from "types";

export interface SelectUserRightProps extends Omit<SelectProps, "children"> {
	value?: UserRightType;
}
const SelectUserRight: React.VFC<SelectUserRightProps> = (props) => (
	<Select
		{...props}
		ghost
		fullWidth={false}
		noMinWidth
	>
		<Option value="view"><Text theme="secondary" size="sm" fontWeight={500}>View</Text></Option>
		<Option value="edit"><Text theme="secondary" size="sm" fontWeight={500}>Edit</Text></Option>
		<Option value="off"><Text theme="error" size="sm" fontWeight={500}>Off</Text></Option>
	</Select>
);

export default SelectUserRight;
