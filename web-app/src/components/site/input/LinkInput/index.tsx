import Input, { InputProps } from "components/base/Input";
import React, { useState } from "react";
import { HeaderSizeType } from "types";
import cc from "classcat";
import IconAdd from "components/base/Icon/IconAdd";
import Spin from "components/base/Spin";
import Text from "components/base/Text";
import Image from "next/image";
import Header from "@/components/base/Header";
import Freizeit from "@/fonts/loader";

export interface LinkInputProps extends InputProps {
  size?: HeaderSizeType;
  loading?: boolean;
  onItemAdd?(urls?: string[]): void;
  progress?: {
    current?: number;
    total?: number;
  };
}

const Popover = () => {
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        zIndex: 3,
        background: "white",
        border: "1px solid #E2E8F0",
        borderRadius: "4px",
        padding: "20px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-16.5px",
          right: "12px",
        }}
      >
        <Image
          src={"/images/ic_arrow_up.svg"}
          alt="Image"
          width={27}
          height={12}
        />
      </div>
      <div
        style={{
          maxWidth: "312px",
          display: "flex",
          gap: "12px",
          flexDirection: "column",
          lineHeight: "17px",
        }}
      >
        <Header className={Freizeit.className} level={5}>
          What you can index?
        </Header>
        <div>
          <Image
            src={"/images/ic_link.svg"}
            alt="Image"
            width={16}
            height={16}
            style={{ marginRight: "8px" }}
          />
          <Text theme="gray5" size="sm">
            <b>Index any URL</b>: It will be crawled and made queryable with
            natural language.
          </Text>
        </div>
        <div>
          <Image
            src={"/images/ic_index_item.svg"}
            alt="Image"
            width={16}
            height={16}
            style={{ marginRight: "8px" }}
          />
          <Text theme="gray5" size="sm">
            <b>Index other indexes</b>: Enable composable discovery by bundling
            other indexes.
          </Text>
        </div>
        <div>
          <Image
            src={"/images/ic_default_index_item.svg"}
            alt="Image"
            width={16}
            height={16}
            style={{ marginRight: "8px" }}
          />
          <Text theme="gray5" size="sm">
            <b>Index ComposeDB streams</b>: Index products, videos, or any kind
            of graph node.
          </Text>
        </div>
      </div>
    </div>
  );
};

const LinkInput: React.FC<LinkInputProps> = ({
  size = 3,
  loading,
  disabled,
  onItemAdd,
  progress,
  ...inputProps
}) => {
  const [url, setUrl] = useState("");
  const [showMsg, setShowMsg] = useState(false);
  const [showPopover, setShowPopover] = useState(false);

  const handleAdd = () => {
    if (url) {
      const words = url.split(" ");
      const links = words.filter((word) => word !== "");
      onItemAdd && onItemAdd(links);
      setUrl("");
    }
  };

  const handleBlur: React.FocusEventHandler<HTMLInputElement> = () => {
    handleAdd();
    setShowPopover(false);
  };

  const handleEnter = (e: any) => {
    if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
      e.preventDefault();
      setShowPopover(false);
      handleAdd();
    }
  };

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({
    target,
  }) => {
    setUrl(target?.value || "");
  };

  return (
    <div
      className="link-input"
      style={{
        position: "relative",
      }}
    >
      {showPopover && <Popover />}
      <Input
        inputSize="xl"
        className={cc(["link-input__input", `link-input-${size}`])}
        disabled={disabled}
        addOnBefore={
          <IconAdd style={{ marginRight: "6px" }} width={20} height={20} />
        }
        addOnAfter={
          loading ? (
            <>
              {progress &&
                progress.total! > 1 &&
                progress.current !== progress.total && (
                  <Text
                    className={"mr-7"}
                    theme={"gray9"}
                  >{`${progress.current}/${progress.total}`}</Text>
                )}
              <Spin active={true} thickness="light" theme="secondary" />
            </>
          ) : (
            <Image
              src={"/images/ic_info.svg"}
              alt="Image"
              width={16}
              height={16}
              onMouseOver={() => setShowPopover(true)}
              onMouseOut={() => setShowPopover(false)}
            />
          )
        }
        {...inputProps}
        value={url}
        onFocus={() => setShowPopover(true)}
        onBlur={handleBlur}
        onChange={handleChange}
        onKeyDown={handleEnter}
        placeholder={
          loading
            ? "Working on it..."
            : "Add an item to your index (link, index or other streams)"
        }
      />
      {showMsg && (
        <Text
          theme="error"
          size="sm"
          style={{
            position: "absolute",
            right: 0,
            bottom: -16,
            zIndex: 2,
          }}
        >
          Please enter a valid url!
        </Text>
      )}
    </div>
  );
};

export default LinkInput;
