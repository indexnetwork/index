import Flex from "components/layout/base/Grid/Flex";
import React, { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "utils/helper";
import cc from "classcat";
import IconCopy from "../Icon/IconCopy";
import Input, { InputProps } from "../Input";
import Text from "../Text";

export interface CopyInputProps extends InputProps {}

const CopyInput = ({ value }: CopyInputProps) => {
  const [copied, setCopied] = useState<boolean>();
  const timeout = useRef<NodeJS.Timeout>();

  const handleCopy = () => {
    copyToClipboard(String(value || ""));
    setCopied(true);
  };

  useEffect(
    () => () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
    },
    [],
  );

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
      className={cc(["copy-input__button", copied ? "copied" : ""])}
      onClick={handleCopy}
      alignitems="flex-end"
    >
      <IconCopy strokeWidth={"1"} className="copy-input__icon" />
      <Text className="copy-input__text" size="sm" fontWeight={400}>
        Copied
      </Text>
    </Flex>
  );

  return (
    <Input
      className="copy-input nonstyled"
      type="text"
      inputSize={"lg"}
      readOnly
      value={value}
      addOnAfter={addOnAfter}
      onClick={handleCopy}
    />
  );
};

export default CopyInput;
