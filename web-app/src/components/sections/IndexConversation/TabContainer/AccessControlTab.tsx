import Soon from "@/components/site/indexes/Soon";

export default function AccessControlTabSection() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          paddingTop: "4rem",
        }}
      >
        <Soon section={"access_control"}></Soon>
      </div>
    </div>
  );
}
