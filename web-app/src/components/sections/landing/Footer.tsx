import Image from "next/image";

const FooterSection = () => {
  return (
    <footer
      style={{
        background: "rgba(110, 191, 244, 0.07)",
      }}
      className="mt-8 py-4 md:mt-16 md:py-8"
    >
      <div className="m-auto flex max-w-screen-lg flex-col gap-12 px-4 pt-8 md:flex-row md:gap-48">
        <div>
          <Image
            width={192}
            height={32}
            src="/images/logo-full-white.svg"
            alt="index network"
          />
        </div>
        <div className="flex flex-row gap-12 md:gap-24">
          <div className="flex flex-col gap-4">
            <h3>Resources</h3>
            <ul className="flex flex-col gap-4 opacity-65">
              <a href="#">
                <li>Documentation</li>
              </a>
              <a href="#">
                <li>Brand Kit</li>
              </a>
              <a href="#">
                <li>Contact</li>
              </a>
            </ul>
          </div>

          <div className="flex flex-col gap-4">
            <h3>Social</h3>
            <ul className="flex flex-col gap-4 opacity-65">
              <a href="#">
                <li>Twitter</li>
              </a>
              <a href="#">
                <li>Discord</li>
              </a>
              <a href="#">
                <li>Github</li>
              </a>
            </ul>
          </div>
        </div>
      </div>
      <div className="m-auto mt-8 max-w-screen-lg md:mt-12">
        <p className="text-center md:text-end">
          © 2024 Index Network. All rights reserved
        </p>
      </div>
    </footer>
  );
};

export default FooterSection;
