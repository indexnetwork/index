import Image from "next/image";
import { useRouter } from "next/navigation";
import Button from "./Button";

const AppHeader = () => {
  const router = useRouter();

  return (
    <header className="app-header">
      <div className="m-auto flex max-w-screen-lg flex-row justify-between p-4">
        <Image
          width={192}
          height={32}
          src="/images/logo-full-white.svg"
          alt="index network"
        />
        <Button
          onClick={() => {
            router.push("https://sjxy3b643r8.typeform.com/to/phuRF52O");
          }}
        >
          Apply for Beta
        </Button>
      </div>
    </header>
  );
};

export default AppHeader;
