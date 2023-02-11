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
	onLinkAdd?(url?: string[]): void;
	progress?: {
		current?: number;
		total?: number;
	};
}

const LinkInput: React.VFC<LinkInputProps> = ({
	size = 3, loading, disabled, onLinkAdd, progress, ...inputProps
}) => {
	const [url, setUrl] = useState("");
	const [showMsg, setShowMsg] = useState(false);
	const handleBlur: React.FocusEventHandler<HTMLInputElement> = () => {
		const words = url.split(" ");

		const links = words.filter((word) => validator.isURL(word));
		onLinkAdd && onLinkAdd(links);
		setUrl("");
	};

	const handleEnter = (e: any) => {
		if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
			e.preventDefault();

			const words = url.split(" ");

			const links = words.filter((word) => validator.isURL(word));
			onLinkAdd && onLinkAdd(links);
			setUrl("");
		}
	};

	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setUrl(target?.value || "");
	};

	return (
		<div className="link-input">
			<Input
				inputSize="xl"
				className={cc([
					"link-input__input",
					`link-input-${size}`,
				])}
				disabled={loading || disabled}
				addOnBefore={<IconAdd width={20} height={20} />}
				addOnAfter={
					loading ? (
						<>
							{progress && (progress.total! > 1 && progress.current !== progress.total) && <Text className={"mr-7"} theme={"gray9"}>{`${progress.current}/${progress.total}`}</Text>}
							<Spin active={true} thickness="light" theme="secondary" />
						</>
					) : undefined
				}
				{...inputProps}
				value={url}
				onBlur={handleBlur}
				onChange={handleChange}
				onKeyDown={handleEnter}
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
