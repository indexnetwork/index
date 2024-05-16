import { twMerge } from "tailwind-merge";

interface BaseButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const BaseButton: React.FC<BaseButtonProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <button
      className={twMerge(
        `border-default bg-pale text-primary whitespace-nowrap rounded-sm border p-2 text-center text-sm font-medium leading-3 ${className}`,
      )}
      {...props}
    >
      {children}
    </button>
  );
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  borderless?: boolean;
  hoverableIcon?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  icon,
  borderless = false,
  hoverableIcon = false,
  className,
  ...props
}) => {
  const borderlessClass = borderless ? "border-none" : "";

  const hoverableIconClass = hoverableIcon
    ? "hover:flex bg-transparent transform transition-transform duration-150"
    : "";

  return (
    <BaseButton
      className={`${borderlessClass} ${className ? className : ""} ${
        hoverableIcon ? "bg-transparent" : ""
      }`}
      {...props}
    >
      {/* Conditionally render icon with hover effect */}
      <div className="flex items-center justify-center gap-4">
        {icon && (
          <span className={`inline-block ${hoverableIconClass}`}>{icon}</span>
        )}
        {children}
      </div>
      {/* {JSON.stringify(hoverableIcon)} */}
    </BaseButton>
  );
};

export default Button;
