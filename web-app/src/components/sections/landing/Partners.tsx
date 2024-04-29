import Image from "next/image";

const PartnersSection = () => {
  return (
    <section className="mb-16 mt-8">
      <div
        className="flex flex-col gap-12 py-6 md:py-12"
        style={{
          background: "rgba(110, 191, 244, 0.07)",
          borderTop: "1px solid rgba(110, 191, 244, 0.2)",
          borderBottom: "1px solid rgba(110, 191, 244, 0.2)",
        }}
      >
        <div className="flex flex-col items-center gap-8">
          <h2 className="text-passiveLight font-title text-2xl opacity-65 md:text-2xl">
            Partners and Allies
          </h2>
          <div className="flex flex-col gap-6 md:gap-8">
            <div className="flex flex-col items-center justify-center gap-6 md:flex-row md:gap-48 md:mb-4 ">
              <Image
                src="/images/partners/ic_ceramic.png"
                alt="Ceramic Network"
                width={240}
                height={50}
              />
              <Image
                src="/images/partners/ic_lit.svg"
                alt="Lit Protocol"
                width={41}
                height={30}
              />
              <Image
                src="/images/partners/ic_fluence.png"
                alt="IPFS"
                width={117}
                height={50}
              />
            </div>

            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-[108px]">
              <Image
                src="/images/partners/ic_olas.png"
                alt="Intuition"
                width={90}
                height={50}
              />
              <Image
                src="/images/partners/ic_disco.png"
                alt="Intuition"
                width={50}
                height={50}
              />
              <Image
                src="/images/partners/ic_verax.png"
                alt="Intuition"
                width={132}
                height={50}
              />
              <Image
                src="/images/partners/ic_intuition.png"
                alt="Intuition"
                width={183}
                height={50}
              />
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
