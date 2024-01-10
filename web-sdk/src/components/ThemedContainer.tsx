interface ThemedContainerProps {
  children: React.ReactNode;
}

const ThemedContainer: React.FC<ThemedContainerProps> = ({ children }) => {
  return (
    <section
      id="IndexChat"
      style={{
        position: 'unset',
      }}
      className="font-primary max-w-container overflow-y-auto max-h-container h-full w-mobileContainer
      m-auto relative md:w-screen p-4 rounded flex-col justify-between items-stretch flex"
    >
      {children}
    </section>
  );
}

export default ThemedContainer;
