import { ShapeType } from "@/types";
import { Users } from "@/types/entity";
import { generateRandomColor, isSSR } from "@/utils/helper";
import cc from "classcat";
import React, { useEffect, useState } from "react";

export interface AvatarProps
  extends React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  > {
  size?: number;
  user?: Users;
  rounded?: boolean;
  creatorRule?: any;
  shape?: ShapeType;
  hoverable?: boolean;
  contentRatio?: number;
  randomColor?: boolean;
  bgColor?: string;
  placeholder?: string;
}

const Avatar = ({
  size = 40,
  user,
  creatorRule,
  children,
  className,
  style,
  rounded,
  bgColor,
  shape = "circle",
  hoverable = false,
  randomColor = false,
  ...divProps
}: AvatarProps) => {
  const maxLetters = size > 32 ? 4 : 2;
  const [color, setColor] = useState<string>(bgColor || "#000");
  const getFontSize = () => size * (1 / maxLetters);
  useEffect(() => {
    if (!isSSR() && randomColor) {
      setColor(generateRandomColor());
    }
  }, []);

  return (
    <div
      {...divProps}
      className={cc([
        "flex",
        "items-center",
        "justify-center",
        rounded ? "rounded-full" : "rounded",
        className || "",
      ])}
      style={{
        ...style,
        width: size,
        height: size,
        color: "#fff",
        lineHeight: `${size}px`,
        fontSize: getFontSize(),
        backgroundColor: user?.avatar ? "none" : color,
      }}
    >
      {user ? (
        user.avatar ? (
          <img
            src={`${user.avatar}`}
            alt="profile_img"
            className={rounded ? "rounded-full" : ""}
          />
        ) : user.name ? (
          user.name!.substring(0, 1).toUpperCase()
        ) : user.id ? (
          user.id
            .toString()
            .slice(maxLetters * -1)
            .toUpperCase()
        ) : (
          "Y"
        )
      ) : creatorRule ? (
        creatorRule.image ? (
          <img
            src={creatorRule.image}
            alt="profile_img"
            className={rounded ? "rounded-full" : ""}
          />
        ) : (
          (creatorRule.symbol || creatorRule.ensName)
            ?.substring(0, 4)
            .toUpperCase()
        )
      ) : typeof children !== "string" ? (
        children
      ) : null}
    </div>
  );
};

export default Avatar;
