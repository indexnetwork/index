import { ReactNode } from "react";

type LoadingTextProps = {
  val: any;
  children: ReactNode;
  loadingComponent?: ReactNode;
};

const LoadingText: React.FC<LoadingTextProps> = ({
  val,
  children,
  loadingComponent,
}) => {
  if (val !== undefined) {
    return <>{children}</>;
  } else {
    return (
      <>
        {loadingComponent || (
          <>
            <div
              style={{
                width: "8em",
                background: "var(--gray-2)",
                height: "1.25em",
                margin: " 0",
              }}
            />
          </>
        )}
      </>
    );
  }
};

export default LoadingText;
