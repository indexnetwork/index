import Icons from "@/assets/icon";
import { useIndexChat } from "@/contexts/ChatContext";
import { useTheme } from "@/contexts/ThemeContext";
import Button from "./ui/Button";
import Avatar from "./ui/Avatar";

const ChatHeader: React.FC = () => {
  const { session, connectWallet, isLoading, messages, clearMessages } =
    useIndexChat();
  const { darkMode, toggleDarkMode } = useTheme();
  const { viewedProfile, userProfile } = useIndexChat();

  const onConnectWallet = () => {
    connectWallet();
  };

  const onToggleDarkMode = () => {
    toggleDarkMode();
  };

  const onClearMessages = () => {
    if (isLoading) return;
    clearMessages();
  };

  return (
    <header className="flex items-center justify-between self-stretch overflow-y-scroll py-2">
      <div className="flex cursor-pointer items-center justify-center gap-2 rounded-[30px] bg-grey-300 px-3 py-2">
        <Avatar user={viewedProfile} size={28} rounded />
        <p className="font-secondary whitespace-nowrap text-sm font-bold leading-3">
          {viewedProfile?.name}
          {/* <span className="font-primary text-xs font-light">(6)</span> */}
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
        {!session && (
          <Button
            // type="primary"
            onClick={onConnectWallet}
            // label="Connect wallet"
          >
            Connect wallet
          </Button>
        )}
        {session && <Avatar user={userProfile} size={28} />}
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
