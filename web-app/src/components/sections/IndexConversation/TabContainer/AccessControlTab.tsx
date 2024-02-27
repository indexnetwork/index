import FlexRow from "@/components/layout/base/Grid/FlexRow";
import Soon from "@/components/site/indexes/Soon";

export default function AccessControlTabSection() {
  return (
    <FlexRow justify="center" align="center" fullHeight>
      <div
        style={{
          paddingTop: "4rem",
        }}
      >
        <Soon section={"access_control"}></Soon>
      </div>
    </FlexRow>
  );
}
