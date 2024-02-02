import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import React from "react";
import Button from "components/base/Button";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import { useBreakpoint } from "hooks/useBreakpoint";
import { BREAKPOINTS } from "utils/constants";
import IndexDetailItemPopup from "components/site/popup/IndexDetailItemPopup";
import { IndexItem } from "types/entity";
import moment from "moment";
import sanitize from "sanitize-html";
import cm from "./style.module.scss";
import { useRole } from "hooks/useRole";

// TODO: data prop will be Index object
export interface LinkItemProps {
  item: IndexItem;
  onChange?(val: IndexItem[]): void;
  search?: boolean;
  handleRemove?(): void;
}

const LinkItem: React.FC<LinkItemProps> = ({
  item,
  search = false,
  handleRemove,
}) => {
  const breakpoint = useBreakpoint(BREAKPOINTS, true);
  const { node } = item;

  const { isCreator } = useRole();

  // const handleToggleNewTag = () => {
  //   setToggleNewTag((oldVal) => !oldVal);
  // };

  // const handleNewTagEdit = async (val?: string | null) => {
  //   if (val) {
  //     const currentLink = await personalCeramic.addTag(link?.id!, val) as Link;
  //     const newState = links.map((l) => (l.id === item.id ? { ...l, link: currentLink } : l));
  //     setItems(newState);
  //   }
  //   setToggleNewTag(false);
  //   setTimeout(() => {
  //     handleToggleNewTag();
  //   }, 0);
  // };

  // const handleCloseTag = () => {
  //   setToggleNewTag(false);
  // };

  // const handleRemove = async () => {
  //   try {
  //     const resp = await api?.deleteItem(indexId, item.node.id);
  //     setItems(items?.filter((l: IndexItem) => l.node.id !== item.node.id));
  //   } catch (error) {
  //     console.error("Error deleting item", error);
  //   }
  //   // const currentLink = await pkpCeramic.removeIndexLink(item);
  //   // onChange && onChange(doc?.content?.links || []);
  // };

  // const handleRemoveTag = async (val: string) => {
  //   const currentLink = await personalCeramic.removeTag(item.linkId!, val) as Link;
  //   const newState = links.map((l) => (l.linkId === item.linkId ? { ...l, link: currentLink } : l));
  //   setItems(newState);
  // };
  return (
    <div className="index-detail-list-item-wrapper">
      <FlexRow className="py-3 index-detail-list-item">
        <Col xs={12}>
          <FlexRow wrap={false}>
            <Col className="idxflex-grow-1" >
              <a target="_blank" rel="noreferrer" href={node?.url}>
                <Text className={cm.title} fontWeight={700}
                  dangerouslySetInnerHTML={{ __html: sanitize(node?.title as string) }}></Text>
                {/* dangerouslySetInnerHTML={{ __html: sanitize((node.highlight && item.highlight["link.title"]) ? item.highlight["link.title"] : node?.title as string) }}></Text> */}
              </a>
            </Col>
            {
              !search && isCreator && (
                <Col className="idxflex-shrink-0 ml-3 index-detail-list-item-buttons">
                  <FlexRow>
                    <Col>
                      {/* <Tooltip content="Add Tag">
                        <Button
                          size="xs"
                          iconButton
                          theme="clear"
                          borderless
                        // onClick={handleToggleNewTag}
                        >
                          <IconTag />
                        </Button>
                      </Tooltip> */}
                    </Col>
                    <Col>
                      <IndexDetailItemPopup onDelete={handleRemove}>
                        <Button
                          size="xs"
                          iconButton
                          theme="clear"
                          borderless><IconContextMenu /></Button>
                      </IndexDetailItemPopup>
                    </Col>
                  </FlexRow>
                </Col>
              )
            }
          </FlexRow>
        </Col>
        <Col xs={12} className="mt-2">
          <a target="_blank" rel="noreferrer" href={node?.url}>
            <img
              className="mr-3"
              src={node?.favicon || "/images/globe.svg"}
              alt="favicon"
              width={16}
              height={16}
              onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                const target = e.target as HTMLImageElement;
                target.onerror = null; // Prevents infinite loop in case fallback image also fails
                target.src = "/images/globe.svg";
              }}
              style={{
                verticalAlign: "middle",
              }} />
            <Text size="sm" theme="disabled">{node?.url?.substring(0, 80)} • {node?.updatedAt ? moment(node?.updatedAt).format("MMM D") : ""}</Text>
          </ a>
        </Col>
        {/* {
          search && node.highlight && node.highlight["link.content"] && (
            <Col className="mt-5">
              <Text className="listItem" theme="secondary" dangerouslySetInnerHTML={{ __html: sanitize(item.highlight["link.content"]) }}></Text>
            </Col>
          )
        } */}
        {
          !search && <Col xs={12} className="mt-3 idxflex idxflex-gap-3 idxflex-wrap">
            {/* {
              node?.tags?.map((t, ind) => (
                <TagIndexDetailItem
                  key={ind}
                  text={t}
                  removable
                  onRemove={handleRemoveTag}
                />))
            } */}
            {/* {
              <TagIndexDetailItem
                theme="clear"
                text=""
                placeholder="New Tag"
                editable={true}
                inputActive
                // onEdit={handleNewTagEdit}
                // onBlur={handleToggleNewTag}
              />
            } */}

          </Col>
        }
      </FlexRow>
    </div>
  );
};
export default LinkItem;
