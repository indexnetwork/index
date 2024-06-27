import Image from "next/image";
import "./animation.css";

export const renderImageBlocks = (blockID: string) => {
  switch (blockID) {
    case "block1":
      return (
        <div className="image-container flex flex-col gap-4">
          <Image
            src="/images/use-cases/message1.png"
            alt="Use Cases"
            width={584}
            height={92}
          />
          <Image
            src="/images/use-cases/message2.png"
            alt="Use Cases"
            width={584}
            height={202}
          />
        </div>
      );
    case "block2":
      return (
        <div className="image-container flex flex-col gap-4">
          <Image
            src="/images/use-cases/message3.png"
            alt="Use Cases"
            width={584}
            height={68}
          />
          <Image
            src="/images/use-cases/message4.png"
            alt="Use Cases"
            width={584}
            height={60}
          />
          <Image
            src="/images/use-cases/message5.png"
            alt="Use Cases"
            width={584}
            height={88}
          />
        </div>
      );
    case "block3":
      return (
        <div className="image-container flex flex-col gap-4">
          <Image
            src="/images/use-cases/message6.png"
            alt="Use Cases"
            width={584}
            height={60}
          />
          <Image
            src="/images/use-cases/message7.png"
            alt="Use Cases"
            width={584}
            height={96}
          />
          <Image
            src="/images/use-cases/message8.png"
            alt="Use Cases"
            width={584}
            height={78}
          />
          <Image
            src="/images/use-cases/message9.png"
            alt="Use Cases"
            width={584}
            height={237}
          />
        </div>
      );
    case "block4":
      return (
        <div className="image-container flex flex-col gap-4">
          <Image
            src="/images/use-cases/message10.png"
            alt="Use Cases"
            width={584}
            height={92}
          />
        </div>
      );
    default:
      return <> </>;
  }
};
