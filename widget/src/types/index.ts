import { CID } from "multiformats/cid";

export enum IndexStatus {
  Init = "init",
  Success = "success",
  Fail = "fail",
}

export enum Participant {
  User = "user",
  Assistant = "assistant",
}

export type Message = {
  content: string;
  role: Participant;
};

export type ParticipantProfile = {
  id: string;
  name: string;
  avatar: CID;
  bio: string;
};

export type PropType<TObj, TProp extends keyof TObj> = TObj[TProp];

export type ShapeType = "square" | "circle";

export type ComponentThemeType =
  | "primary"
  | "secondary"
  | "success"
  | "error"
  | "warning"
  | "disabled"
  | "blue";

/**
 * Button Types
 */
export type ButtonThemeType =
  | ComponentThemeType
  | "primary-outlined"
  | "secondary-outlined"
  | "success-outlined"
  | "error-outlined"
  | "warning-outlined"
  | "ghost"
  | "card"
  | "link"
  | "clear"
  | "blue"
  | "blue-outlined"
  | "tag"
  | "panel";

export type SizeType = "xs" | "sm" | "md" | "lg" | "xl";
/**
 * Input Types
 */
export type InputSizeType = SizeType;

/**
 * Text Types
 */
export type TextThemeType =
  | ComponentThemeType
  | "gray4"
  | "gray5"
  | "gray6"
  | "white"
  | "gray9";

export type TextElementType = "span" | "strong" | "div" | "p" | "label";
export type TextSizeType = SizeType;
