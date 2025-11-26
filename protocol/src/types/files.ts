import { ISODateString, UUID } from './common';

export interface FileRecord {
  id: UUID;
  name: string;
  type: string;
  size: number | string;
  createdAt: ISODateString;
  url?: string;
  userId?: UUID;
}

export interface FileUploadResponse {
  file: FileRecord;
  message: string;
}

export interface AvatarUploadResponse {
  message: string;
  avatarFilename: string;
}