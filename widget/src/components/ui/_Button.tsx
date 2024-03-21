import { CSSProperties, ReactNode, MouseEvent } from "react";

interface BaseButtonProps {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  styles?: CSSProperties;
  label: ReactNode;
}

const BaseButton: React.FC<BaseButtonProps> = ({ onClick, styles, label }) => {
  return (
    <button
      style={styles}
      onClick={onClick}
      className="border-default bg-pale text-primary whitespace-nowrap rounded-sm border p-2 text-center text-sm font-medium leading-3"
    >
      {label}
    </button>
  );
};

export interface ButtonProps extends BaseButtonProps {
  type?: "primary" | "secondary";
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ type = "primary", ...props }) => {
  const buttonStyles: CSSProperties = {
    ...props.styles,
  };

  return <BaseButton {...props} styles={buttonStyles} />;
};

export default Button;
