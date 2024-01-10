import { CSSProperties, ReactNode, MouseEvent } from 'react';

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
      className="text-center border-default bg-pale text-primary p-2 whitespace-nowrap rounded-sm border text-sm font-medium leading-3"
    >
      {label} 
    </button>
  );
};

interface ButtonProps extends BaseButtonProps {
  type?: 'primary' | 'secondary';
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ type = 'primary', ...props }) => {
  const buttonStyles: CSSProperties = {
    ...props.styles,
  };

  return <BaseButton {...props} styles={buttonStyles} />;
};

export default Button;
