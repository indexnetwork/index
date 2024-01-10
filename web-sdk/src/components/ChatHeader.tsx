import { useChat } from "@/contexts/ChatContext";
import { useTheme } from "@/contexts/ThemeContext";
import Icons from "@/assets/icon";
import Button from "./ui/Button";

const ChatHeader: React.FC = () => {
  const { isWalletConnected, setIsWalletConnected, isLoading, messages, clearMessages } = useChat();
  const { darkMode, toggleDarkMode } = useTheme();
  const { userProfile } = useChat();

  const onConnectWallet = () => {
    setIsWalletConnected(true);
  }

  const onToggleDarkMode = () => {
    toggleDarkMode();
  }

  const onClearMessages = () => {
    if (isLoading) return;
    clearMessages();
  }

  return (
    <header className="overflow-y-scroll self-stretch justify-between items-center flex">
      <div className="cursor-pointer px-3 py-2 bg-orange-600 rounded-[30px] justify-center items-center gap-2 flex">
        <Icons.Ceramic className="w-4 h-4 rounded-sm" />
        <p className="whitespace-nowrap leading-3 text-sm font-bold font-secondary">Ceramic Network
          <span className="text-xs font-light font-primary">(6)</span>
        </p>
      </div>

      <div className="flex flex-row gap-2 items-center">
        {messages && messages.length > 0 && (
          <Button
            type="primary"
            onClick={onClearMessages}
            label="Reset"
          />
        )}
        {!isWalletConnected &&
          <Button
            type="primary"
            onClick={onConnectWallet} label="Connect wallet" />
        }
        <img alt="User Avatar" className="w-8 h-8 rounded-sm" src={userProfile?.avatar} />
        <button onClick={onToggleDarkMode} aria-label="toggle-dark-mode" className="p-1 flex items-center rounded">
          {darkMode ? <Icons.Sun /> : <Icons.Moon />}
        </button>
      </div>
    </header>
  );
}

export default ChatHeader;