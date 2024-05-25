import React, { forwardRef, useState } from "react";
import cc from "classcat";
import { InputSizeType, PropType } from "types";
import Flex from "components/layout/base/Grid/Flex";
import TextareaAutosize, {
  TextareaAutosizeProps,
} from "react-textarea-autosize";
import IconVisible from "../Icon/IconVisible";
import IconInvisible from "../Icon/IconInvisible";

export interface TextAreaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  inputSize?: InputSizeType;
  block?: boolean;
  ghost?: boolean;
  addOnBefore?: React.ReactNode;
  addOnAfter?: React.ReactNode;
  type?: PropType<React.InputHTMLAttributes<HTMLInputElement>, "type">;
}

const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextAreaProps & TextareaAutosizeProps
>(
  (
    {
      className,
      addOnBefore,
      addOnAfter,
      disabled,
      readOnly,
      type,
      style,
      block = true,
      ghost = false,
      inputSize = "md",
      rows = 6,
      ...inputProps
    }: TextAreaProps & TextareaAutosizeProps,
    ref,
  ) => {
    const [showPw, setShowPw] = useState(false);

    const handleTogglePw = () => {
      setShowPw((oldVal) => !oldVal);
    };
    const renderVisible = showPw ? (
      <IconInvisible onClick={handleTogglePw} />
    ) : (
      <IconVisible onClick={handleTogglePw} />
    );

    return (
      <Flex
        className={cc([
          "textarea",
          `textarea-${inputSize}`,
          ghost ? "textarea-ghost" : "",
          block ? "textarea-block" : "",
          disabled ? "textarea-disabled" : "",
          readOnly ? "textarea-readonly" : "",
          className,
        ])}
        style={style}
      >
        {addOnBefore}
        <TextareaAutosize
          ref={ref}
          {...inputProps}
          disabled={disabled}
          readOnly={readOnly}
          rows={rows}
          style={{
            width: "100%",
            overflow: "auto",
          }}
          className={"textarea__textarea"}
        />
        {type === "password" ? renderVisible : addOnAfter}
      </Flex>
    );
  },
);
TextArea.displayName = "TextArea";
export default TextArea;
