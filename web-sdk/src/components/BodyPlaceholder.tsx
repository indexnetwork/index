import { TipBoxData, TipContainer } from "./ui/TipBox";
import Cover from '@/assets/image/cover.png';
import CoverDark from '@/assets/image/cover-dark.png';

interface BodyPlaceholderProps {
  darkMode: boolean;
  sendMessage: (message: string) => void;
  tipBoxes: TipBoxData[];
}

const BodyPlaceholder: React.FC<BodyPlaceholderProps> = ({ darkMode, sendMessage, tipBoxes }) => {
  return (
    <div aria-label="chat-body-placeholder" className="self-stretch pt-6 sm:pt-10 flex-col justify-between items-center flex md:gap-12  gap-8">
      <div className="flex-col justify-start items-center flex">
        <img className="w-[9em] h-[9em] md:w-[11.5em] md:h-[11.5em]" src={darkMode ? CoverDark : Cover} />
        <div className="flex-col justify-start items-center gap-3 flex">
          <div className="text-center text-xl font-bold font-secondary">Chat with Ceramic Network</div>
          <div className="self-stretch text-center text-xs font-normal ">You can include your indexes by connecting your wallet</div>
        </div>
      </div>
      <TipContainer
        tipBoxes={tipBoxes}
        onTipBoxClick={(tipBoxData) => {
          sendMessage(tipBoxData.content)
        }}
      />
    </div>

  )
}

export default BodyPlaceholder