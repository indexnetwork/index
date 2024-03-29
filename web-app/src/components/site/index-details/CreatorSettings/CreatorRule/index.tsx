import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Header from "components/base/Header";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import IconCopy from "components/base/Icon/IconCopy";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Row from "components/layout/base/Grid/Row";
import CreatorRulePopup from "components/site/popup/CreatorRulePopup";

import { copyToClipboard, maskAddress } from "utils/helper";

export interface CreatorRuleProps {
  rule: any;
  handleRemove: () => void;
}

const CreatorRule = ({ rule, handleRemove }: CreatorRuleProps) =>
  !rule?.ruleType ? (
    <p>{JSON.stringify(rule)} </p>
  ) : (
    <div className="card-item p-6">
      <FlexRow justify={"between"} fullWidth>
        <Col xs={10}>
          <Flex
            className={"idxflex-nowrap"}
            alignitems={"top"}
            flexdirection={"column"}
          >
            <Row>
              <Text fontFamily="Freizeit" fontWeight={500}>
                {rule.ruleType === "nftOwner"
                  ? rule.standardContractType === "ERC721" && rule.tokenId
                    ? "NFT OWNER"
                    : "NFT OWNERS"
                  : "INDIVIDUAL WALLET"}
              </Text>
            </Row>
            <Row className={"mt-3"}>
              <Flex alignitems={"left"}>
                <Col>
                  <Avatar
                    size={40}
                    creatorRule={rule}
                    hoverable
                    className={"site-navbar__avatar mr-3"}
                  />
                </Col>
                <Col>
                  <Header level={4} className="mb-1">
                    {rule?.name ||
                      rule?.ensName ||
                      (rule?.walletAddress &&
                        maskAddress(rule?.walletAddress)) ||
                      (rule?.contractAddress &&
                        maskAddress(rule?.contractAddress))}
                  </Header>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      fontFamily={"Freizeit"}
                      fontWeight={500}
                      size={"sm"}
                      className={"mr-1"}
                    >
                      {maskAddress(
                        rule?.walletAddress || rule?.contractAddress,
                      )}
                    </Text>
                    <Button
                      onClick={() => {
                        copyToClipboard(
                          `${rule?.walletAddress || rule?.contractAddress}`,
                        );
                      }}
                      iconButton
                      theme="clear"
                      size={"xs"}
                      borderless
                    >
                      <IconCopy />
                    </Button>
                  </div>
                </Col>
              </Flex>
            </Row>
          </Flex>
        </Col>
        <Col pullRight>
          <CreatorRulePopup rule={rule} onRemove={handleRemove}>
            <Button size="sm" borderless iconButton theme="clear">
              <IconContextMenu />
            </Button>
          </CreatorRulePopup>
        </Col>
      </FlexRow>
    </div>
  );

export default CreatorRule;
