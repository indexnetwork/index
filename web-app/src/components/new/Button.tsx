interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "outline";
  className?: string;
}

const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = "primary",
  className = "",
}) => {
  // Base styles
  const baseStyles =
    "px-4 font-secondary leading-none py-2 font-medium text-base rounded-sm focus:outline-none focus:ring-2 focus:ring-offset-2";

  // Variant-specific styles
  const variantStyles = {
    primary: "bg-primary text-passiveDark",
    outline: "border border-passiveLight text-primary",
  };

  // Combine styles based on the variant
  const buttonClasses = `${baseStyles} ${variantStyles[variant]} ${className}`;

  return (
    <button onClick={onClick} className={buttonClasses}>
      {children}
    </button>
  );
};

export default Button;
