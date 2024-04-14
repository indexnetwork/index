import Icons from "@/assets/icon";
import { useIndexChat } from "@/contexts/ChatContext";
import { useTheme } from "@/contexts/ThemeContext";
import Button from "./ui/Button";

const ChatHeader: React.FC = () => {
  const {
    isWalletConnected,
    setIsWalletConnected,
    isLoading,
    messages,
    clearMessages,
  } = useIndexChat();
  const { darkMode, toggleDarkMode } = useTheme();
  const { userProfile } = useIndexChat();

  const onConnectWallet = () => {
    setIsWalletConnected(true);
  };

  const onToggleDarkMode = () => {
    toggleDarkMode();
  };

  const onClearMessages = () => {
    if (isLoading) return;
    clearMessages();
  };

  return (
    <header className="flex items-center justify-between self-stretch overflow-y-scroll">
      <div className="flex cursor-pointer items-center justify-center gap-2 rounded-[30px] bg-orange-600 px-3 py-2">
        <Icons.Ceramic className="h-4 w-4 rounded-sm" />
        <p className="font-secondary whitespace-nowrap text-sm font-bold leading-3">
          Ceramic Network
          <span className="font-primary text-xs font-light">(6)</span>
        </p>
      </div>

      <div className="flex flex-row items-center gap-2">
        {messages && messages.length > 0 && (
          <Button
            // type="primary"
            onClick={onClearMessages}
            // label="Reset"
          >
            Reset
          </Button>
        )}
        {/* {!isWalletConnected && (
          <Button
            // type="primary"
            onClick={onConnectWallet}
            // label="Connect wallet"
          >
            Connect wallet
          </Button>
        )} */}
        <img
          alt="User Avatar"
          className="h-8 w-8 rounded-sm"
          src={userProfile?.avatar as any}
        />
        <button
          onClick={onToggleDarkMode}
          aria-label="toggle-dark-mode"
          className="flex items-center rounded p-1"
        >
          {darkMode ? <Icons.Sun /> : <Icons.Moon />}
        </button>
      </div>
    </header>
  );
};

export default ChatHeader;
