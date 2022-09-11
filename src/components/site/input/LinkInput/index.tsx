import Input, { InputProps } from "components/base/Input";
import React, { useState } from "react";
import { HeaderSizeType } from "types";
import cc from "classcat";
import IconAdd from "components/base/Icon/IconAdd";
import validator from "validator";
import Spin from "components/base/Spin";
import Text from "components/base/Text";

export interface LinkInputProps extends InputProps {
	size?: HeaderSizeType;
	loading?: boolean;
	onLinkAdd?(url?: string): void;
}

const LinkInput: React.VFC<LinkInputProps> = ({
	size = 3, loading, disabled, onLinkAdd, ...inputProps
}) => {
	const [url, setUrl] = useState("");
	const [showMsg, setShowMsg] = useState(false);

	const handleBlur: React.FocusEventHandler<HTMLInputElement> = () => {
		if (validator.isURL(url)) {
			onLinkAdd && onLinkAdd(url);
			setUrl("");
		} else if (url) {
			setShowMsg(true);
			setTimeout(() => {
				setShowMsg(false);
				setUrl("");
			}, 1500);
		}
	};

	const handleKeydown = (event: React.KeyboardEvent<LinkInputProps>) => {
		if (event.key === "Enter") {
			if (validator.isURL(url)) {
				onLinkAdd && onLinkAdd(url);
				setUrl("");
			} else if (url) {
				setShowMsg(true);
				setTimeout(() => {
					setShowMsg(false);
					setUrl("");
				}, 1500);
			}
		}
	};

	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setUrl(target?.value || "");
	};

	return (
		<div className="link-input">
			<Input
				inputSize="sm"
				className={cc([
					"link-input__input",
					`link-input-${size}`,
				])}
				disabled={loading || disabled}
				addOnBefore={<IconAdd width={12} height={12} />}
				addOnAfter={loading ? <Spin active={true} thickness="light" theme="secondary" /> : undefined}
				{...inputProps}
				value={url}
				onBlur={handleBlur}
				onChange={handleChange}
				onKeyDown={(e) => handleKeydown(e) }
				placeholder={loading ? "Working on it..." : "Add a link to your index"}
			/>
			{showMsg && <Text theme="error" size="sm"
			 style={{
					position: "absolute",
					right: 0,
					bottom: -16,
					zIndex: 2,
			 }}
			>Please enter a valid url!</Text>}
		</div >
	);
};

export default LinkInput;
