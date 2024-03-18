import { randomBytes } from "crypto";

export const randomString = (length: number): string => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  const bytes = randomBytes(length);

  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] % charactersLength;
    result += characters.charAt(byte);
  }

  return result;
};
