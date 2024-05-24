import Freizeit from "@/fonts/loader";
import cc from "classcat";
import Input, { InputProps } from "components/base/Input";
import Spin from "components/base/Spin";
import React from "react";
import { HeaderSizeType } from "types";

export interface HeaderInputProps extends InputProps {
  size?: HeaderSizeType;
  loading?: boolean;
}

const HeaderInput: React.VFC<HeaderInputProps> = ({
  size = 3,
  loading,
  ...inputProps
}) => (
  <Input
    inputSize="sm"
    addOnAfter={
      loading && <Spin active={true} thickness="light" theme="secondary" />
    }
    className={cc([
      Freizeit.className,
      "header-input",
      "nonstyled",
      `header-input-${size}`,
    ])}
    {...inputProps}
  />
);

export default HeaderInput;
