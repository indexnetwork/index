export function ContentContainer({ 
  children, 
  className = "",
  size = "default" 
}: { 
  children: React.ReactNode;
  className?: string;
  size?: "default" | "wide";
}) {
  const maxWidth = size === "wide" ? "max-w-4xl" : "max-w-3xl";
  return (
    <div className={`${maxWidth} mx-auto ${className}`.trim()}>
      {children}
    </div>
  );
}
