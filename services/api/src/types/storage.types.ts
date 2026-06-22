/** Storage adapter interface for file operations. */
export interface StorageAdapter {
  /** Upload a library file and return its S3 key. */
  uploadFile(
    buffer: Buffer,
    userId: string,
    fileId: string,
    extension: string,
    contentType: string,
  ): Promise<string>;

  /** Download a file by S3 key and return its content as a Buffer. */
  downloadFile(key: string): Promise<Buffer>;

  /** Upload an avatar image and return its S3 key. */
  uploadAvatar(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string>;

  /** Upload an index image and return its S3 key. */
  uploadIndexImage(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string>;
}
