import Icon from "@/assets/icon";

interface PoweredByProps {
  website?: string;
}

const PoweredBy: React.FC<PoweredByProps> = ({ website }) => {
  return (
    <a href={website} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2">
      <div className="absolute right-[2em] rounded-b-lg md:rounded-none md:rounded-t-lg bottom-[-29px]  w-fit text-center text-2xs bg-grey-600 flex items-center justify-center gap-2 px-2 py-1.5 font-light text-gray-400 md:absolute md:left-auto md:bottom-16 md:right-[-29px] md:translate-x-0 md:rotate-90 md:-translate-y-1/2 md:origin-top-right">
        <p className="flex text-white items-center gap-2">
          Powered by <span><Icon.Index /></span>
        </p>
      </div>
    </a>
  );
};

export default PoweredBy;
