import { useAuth } from "@/context/AuthContext";
import Image from "next/image";
import Button from "./Button";

const AppHeader = () => {
  const { connect } = useAuth();

  return (
    <header className="app-header">
      <div className="m-auto flex max-w-screen-lg flex-row justify-between p-4">
        <Image
          width={192}
          height={32}
          src="/images/logo-full-white.svg"
          alt="index network"
        />
        <Button onClick={connect}>Connect</Button>
      </div>
    </header>
  );
};

export default AppHeader;
