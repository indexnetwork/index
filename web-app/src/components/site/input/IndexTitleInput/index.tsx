import {
  ChangeEventHandler,
  FC,
  FocusEventHandler,
  useEffect,
  useState,
} from "react";
import HeaderInput from "../HeaderInput";

export interface IndexTitleInputProps {
  defaultValue: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (value: string) => void;
}

const IndexTitleInput: FC<IndexTitleInputProps> = ({
  defaultValue,
  disabled,
  loading,
  onChange,
}) => {
  const [title, setTitle] = useState(defaultValue);

  useEffect(() => {
    setTitle(defaultValue || "");
  }, [defaultValue]);

  const handleBlur: FocusEventHandler<HTMLInputElement> = () => {
    if (title && title !== defaultValue) {
      onChange(title);
    }
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = ({
    target,
  }: {
    target: HTMLInputElement;
  }) => {
    setTitle(target?.value || "");
  };

  const handleEnter = (e: any) => {
    if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
      e.preventDefault();

      if (title && title !== defaultValue) {
        onChange(title);
      }
    }
  };

  return (
    <HeaderInput
      type="text"
      onBlur={handleBlur}
      value={title}
      onKeyDown={handleEnter}
      onChange={handleChange}
      disabled={disabled}
      loading={loading}
    />
  );
};

export default IndexTitleInput;
