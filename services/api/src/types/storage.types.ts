/** Storage adapter interface for image uploads. */
export interface StorageAdapter {
  /** Download a file by S3 key and return its content as a Buffer. */
  downloadFile(key: string): Promise<Buffer>;

  /** Upload an avatar image and return its S3 key. */
  uploadAvatar(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string>;

  /** Upload a network image and return its S3 key. */
  uploadNetworkImage(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string>;
}
