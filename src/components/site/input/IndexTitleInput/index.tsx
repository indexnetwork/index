import React, { useEffect, useState } from "react";
import HeaderInput from "../HeaderInput";

export interface IndexTitleInputProps {
	defaultValue: string;
	disabled?: boolean;
	onChange(value: string): void;
}
const IndexTitleInput: React.VFC<IndexTitleInputProps> = ({
	defaultValue,
	disabled,
	onChange,
}) => {
	const [title, setTitle] = useState(defaultValue);

	useEffect(() => {
		setTitle(defaultValue || "");
	}, [defaultValue]);

	const handleBlur: React.FocusEventHandler<HTMLInputElement> = () => {
		if (title && title !== defaultValue) {
			onChange(title);
		}
	};

	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setTitle(target?.value || "");
	};

	return (
		<HeaderInput
			type="text"
			placeholder="Enter your index title"
			onBlur={handleBlur}
			value={title}
			onChange={handleChange}
			disabled={disabled}
		/>
	);
};

export default IndexTitleInput;
