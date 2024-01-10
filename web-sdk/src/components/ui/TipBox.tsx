interface TipBoxProps {
  content: string;
  icon: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
}

export const TipBox: React.FC<TipBoxProps> = ({ content, icon, onClick, style }) => {
  return (
    <div
      className="transition-shadow duration-300 ease-in-out
       hover:shadow-md text-primary bg-pale border-default cursor-pointer flex gap-2 p-4 rounded border"
      onClick={onClick}
      style={style}
    >
      <div className='w-6 h-6'>{icon}</div>
      <p className="text-sm font-medium">{content}</p>
    </div>
  );
};

export interface TipBoxData {
  content: string;
  icon: JSX.Element;
}

interface TipContainerProps {
  tipBoxes: TipBoxData[];
  onTipBoxClick: (tipBoxData: TipBoxData) => void;
}

export const TipContainer: React.FC<TipContainerProps> = ({
  tipBoxes,
  onTipBoxClick,
}) => {
  return (
    <div className="px-1 w-full flex flex-col md:grid md:grid-cols-2 gap-3">
      {tipBoxes.map((tBox, index) => (
        <TipBox
          key={index}
          content={tBox.content}
          icon={tBox.icon}
          onClick={() => onTipBoxClick(tBox)}
        />
      ))}
    </div>
  );
};
