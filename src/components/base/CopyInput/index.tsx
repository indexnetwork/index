import Flex from "layout/base/Grid/Flex";
import React, { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "utils/helper";
import cc from "classcat";
import IconCopy from "../Icon/IconCopy";
import Input, { InputProps } from "../Input";
import Text from "../Text";

export interface CopyInputProps extends InputProps { }

const CopyInput: React.FC<CopyInputProps> = ({ value }) => {
	const [copied, setCopied] = useState<boolean>();
	const timeout = useRef<NodeJS.Timeout>();

	const handleCopy = () => {
		copyToClipboard(String(value || ""));
		setCopied(true);
	};

	useEffect(() => () => {
		if (timeout.current) {
			clearTimeout(timeout.current);
		}
	}, []);

	useEffect(() => {
		if (copied) {
			timeout.current = setTimeout(() => {
				setCopied(false);
				timeout.current = undefined;
			}, 2000);
		}
	}, [copied]);

	const addOnAfter = (
		<Flex
			className={cc(["idx-copy-input__button", copied ? "copied" : ""])}
			onClick={handleCopy}
		>
			<IconCopy strokeWidth={"1.8"} className="idx-copy-input__icon" />
			<Text className="idx-copy-input__text" size="sm" fontWeight={600}>Copied</Text>
		</Flex>
	);

	return (
		<Input
			className="idx-copy-input"
			type="text"
			readOnly
			value={value}
			addOnAfter={addOnAfter}
			onClick={handleCopy}
		/>
	);
};

export default CopyInput;
