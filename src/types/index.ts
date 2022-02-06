import { NextPage } from "next/types";
import { ReactElement, ReactNode } from "react";

/**
 * Common Types
 */
export type NextPageWithLayout = NextPage & {
  getLayout?: (page: ReactElement) => ReactNode
};

export type ComponentThemeType = "primary" | "secondary" | "success" | "error" | "warning";
export type SizeType = "xs" | "sm" | "md" | "lg";

/**
 * Text Types
 */
export type TextThemeType = ComponentThemeType;
export type TextElementType = "span" | "strong" | "div" | "p";

/**
 * Button Types
 */
export type ButtonThemeType = ComponentThemeType | "primary-outlined" | "secondary-outlined" | "success-outlined" | "error-outlined" | "warning-outlined" | "ghost" | "link";
export type ButtonSizeType = Exclude<SizeType, "xs">;

/**
 * Size Types
 */
export type TextSizeType = SizeType;
