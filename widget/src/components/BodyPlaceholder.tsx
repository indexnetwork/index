import { TipBoxData, TipContainer } from "./ui/TipBox";
import Cover from "@/assets/image/cover.png";
import CoverDark from "@/assets/image/cover-dark.png";

interface BodyPlaceholderProps {
  darkMode: boolean;
  sendMessage: (message: string) => void;
  tipBoxes: TipBoxData[];
}

const BodyPlaceholder: React.FC<BodyPlaceholderProps> = ({
  darkMode,
  sendMessage,
  tipBoxes,
}) => {
  return (
    <div
      aria-label="chat-body-placeholder"
      className="flex flex-col items-center justify-between gap-8 self-stretch pt-4 sm:pt-6  md:gap-8"
    >
      <div className="flex flex-col items-center justify-start">
        <img
          className="h-[9em] w-[9em] md:h-[11.5em] md:w-[11.5em]"
          src={darkMode ? CoverDark : Cover}
        />
        <div className="flex flex-col items-center justify-start gap-3">
          <div className="font-secondary text-center text-xl font-bold">
            Chat with Ceramic Network
          </div>
          <div className="self-stretch text-center text-xs font-normal ">
            You can include your indexes by connecting your wallet
          </div>
        </div>
      </div>
      <TipContainer
        tipBoxes={tipBoxes}
        onTipBoxClick={(tipBoxData) => {
          sendMessage(tipBoxData.content);
        }}
      />
    </div>
  );
};

export default BodyPlaceholder;
