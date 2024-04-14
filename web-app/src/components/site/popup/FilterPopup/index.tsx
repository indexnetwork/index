import Button from "components/base/Button";
import Checkbox from "components/base/Checkbox";
import Collapse from "components/base/Collapse";
import IconSearch from "components/base/Icon/IconSearch";
import Input from "components/base/Input";
import Popup, { PopupHandles } from "components/base/Popup";
import RadioGroup from "components/base/RadioGroup";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useRef } from "react";

export interface FilterPopupProps {
  children: React.ReactNode;
}

const FilterPopup = ({ children }: FilterPopupProps) => {
  const popup = useRef<PopupHandles>(null);

  const handleApply = () => {
    popup.current && popup.current.close();
  };

  const handleClear = () => {};

  return (
    <Popup
      ref={popup}
      popupClass="filter-popup-wrapper"
      menuClass="filter-popup-menu"
      closeOnMenuClick={false}
      position="bottom-right"
      content={
        <FlexRow className="px-4 py-6" rowSpacing={3} colSpacing={2}>
          <Col xs={12}>
            <Collapse title="TYPE" key="type">
              <FlexRow>
                <Col xs={6}>
                  <Checkbox title="Article" />
                </Col>
                <Col xs={6}>
                  <Checkbox title="Video" />
                </Col>
                <Col xs={6}>
                  <Checkbox title="Image" />
                </Col>
                <Col xs={6}>
                  <Checkbox title="Custom" />
                </Col>
              </FlexRow>
            </Collapse>
          </Col>
          <Col xs={12}>
            <Collapse title="PUBLISH DATE" key="publish" collapsed>
              <RadioGroup
                items={[
                  {
                    value: "today",
                    title: "Today",
                  },
                  {
                    value: "week",
                    title: "This Week",
                  },
                  {
                    value: "month",
                    title: "This Month",
                  },
                  {
                    value: "year",
                    title: "This Year",
                  },
                ]}
              />
            </Collapse>
          </Col>
          <Col xs={12}>
            <Collapse title="UPLOAD DATE" key="upload">
              <RadioGroup
                items={[
                  {
                    value: "today",
                    title: "Today",
                  },
                  {
                    value: "week",
                    title: "This Week",
                  },
                  {
                    value: "month",
                    title: "This Month",
                  },
                  {
                    value: "year",
                    title: "This Year",
                  },
                ]}
              />
            </Collapse>
          </Col>
          <Col xs={12} className="mb-3">
            <Collapse title="TAG" key="tag">
              <Flex flexdirection="column">
                <Input
                  inputSize="xs"
                  addOnBefore={<IconSearch />}
                  placeholder="Search in tags"
                  className="mb-3"
                />
                <RadioGroup
                  items={[
                    {
                      value: "today",
                      title: "Today",
                    },
                    {
                      value: "week",
                      title: "This Week",
                    },
                    {
                      value: "month",
                      title: "This Month",
                    },
                    {
                      value: "year",
                      title: "This Year",
                    },
                  ]}
                />
              </Flex>
            </Collapse>
          </Col>
          <Col xs={6}>
            <Button size="xs" block theme="clear" onClick={handleClear}>
              Clear
            </Button>
          </Col>
          <Col xs={6}>
            <Button size="xs" block onClick={handleApply}>
              Apply
            </Button>
          </Col>
        </FlexRow>
      }
    >
      {children}
    </Popup>
  );
};

export default FilterPopup;
