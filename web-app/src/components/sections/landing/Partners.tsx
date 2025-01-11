import Image from "next/image";

const PartnersSection = () => {
  return (
    <section className="mb-16 mt-8">
      <div className="flex flex-col gap-12 py-6 md:py-12">
        <div className="flex flex-col items-center gap-8">
          <h2 className="text-passiveLight font-title text-2xl opacity-65 md:text-2xl">
            Partners and Allies
          </h2>
          <div className="flex flex-col gap-6 md:gap-8">
            <div className="flex flex-col items-center justify-center gap-6 md:flex-row md:gap-48 md:mb-4 ">
              <a href="https://ceramic.network/" target="_blank">
                <Image
                  src="/images/partners/ic_ceramic.png"
                  alt="Ceramic Network"
                  width={240}
                  height={50}
                />
              </a>
              <a href="https://www.litprotocol.com/" target="_blank">
                <Image
                  src="/images/partners/ic_lit.svg"
                  alt="Lit Protocol"
                  width={41}
                  height={30}
                />
              </a>
              <a href="https://fleek.network/" target="_blank">
                <Image
                  src="/images/partners/ic_fleek.png"
                  alt="Fleek Network"
                  width={200}
                  height={50}
                />
              </a>

            </div>

            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-[108px]">
              <a href="https://olas.network/" target="_blank">
                <Image
                  src="/images/partners/ic_olas.png"
                  alt="Olas Network"
                  width={90}
                  height={50}
                />
              </a>

              <a href="https://opengradient.ai/" target="_blank">
                <Image
                  src="/images/partners/ic_opengradient.png"
                  alt="Opengradient"
                  width={200}
                  height={50}
                />
              </a>

              <a href="https://www.ver.ax/" target="_blank">
                <Image
                  src="/images/partners/ic_verax.png"
                  alt="Verax"
                  width={132}
                  height={50}
                />
              </a>
              <a href="https://www.intuition.systems/" target="_blank">
                <Image
                  src="/images/partners/ic_intuition.png"
                  alt="Intuition"
                  width={183}
                  height={50}
                />
              </a>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-8">
          <h2 className="text-passiveLight font-title text-2xl opacity-65 md:text-2xl">
            Backed by
          </h2>
          <div className="flex flex-col gap-6">
            <Image
              src="/images/partners/ic_consensys.svg"
              alt="Consensys"
              width={154}
              height={100}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default PartnersSection;
