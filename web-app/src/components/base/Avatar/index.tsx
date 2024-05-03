import React, { useEffect, useState } from "react";
import { generateRandomColor, isSSR } from "utils/helper";
import { ShapeType } from "types";
import { Users } from "types/entity";
import { appConfig } from "config";
import Image from "next/image";

export interface AvatarProps
  extends React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  > {
  size?: number;
  user?: Users;
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
  bgColor,
  shape = "circle",
  hoverable = false,
  randomColor = false,
  ...divProps
}: AvatarProps) => {
  const maxLetters = size > 32 ? 4 : 2;
  const [color, setColor] = useState<string>(bgColor || "var(--main)");
  const getFontSize = () => size * (1 / maxLetters);

  useEffect(() => {
    if (!isSSR() && randomColor) {
      setColor(generateRandomColor());
    }
  }, []);

  function getClassName() {
    const classes = ["avatar", `avatar-${shape}`];
    if (hoverable) classes.push("avatar-hoverable");
    if (className) classes.push(className);
    return classes.join(" ");
  }

  function getUserAvatar() {
    if (user && user.avatar) {
      return (
        <Image
          width={size}
          height={size}
          src={`${appConfig.ipfsProxy}/${user.avatar}`}
          alt="Profile Image"
        />
      );
    }
    if (user && !user.avatar && user.name) {
      return user.name.substring(0, 1).toUpperCase();
    }
    if (user && !user.avatar && !user.name && user.id) {
      return user.id
        .toString()
        .slice(maxLetters * -1)
        .toUpperCase();
    }

    return null;
  }

  function getCreatorRuleAvatar() {
    if (!user && creatorRule && creatorRule.image) {
      return <img src={creatorRule.image} alt="profile_img" />;
    }
    if (!user && creatorRule && !creatorRule.image) {
      return (creatorRule.symbol || creatorRule.ensName)
        ?.substring(0, 4)
        .toUpperCase();
    }
    return null;
  }

  return (
    <div
      {...divProps}
      className={getClassName()}
      style={{
        ...style,
        width: size,
        height: size,
        lineHeight: `${size}px`,
        fontSize: getFontSize(),
        backgroundColor: color,
      }}
    >
      {getUserAvatar()}
      {getCreatorRuleAvatar()}
      {typeof children !== "string" && children}
    </div>
  );
};

export default Avatar;
