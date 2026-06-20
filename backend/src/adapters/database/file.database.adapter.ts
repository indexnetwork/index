import { CreateFileInput, FileListResult, FileMetadata, FileRow, and, count, db, desc, eq, files, inArray, isNull } from './_shared';

export class FileDatabaseAdapter {
  /**
   * Get files by IDs for a specific user
   */
  async getFilesByIds(userId: string, fileIds: string[]): Promise<FileMetadata[]> {
    if (!fileIds?.length) return [];
    
    return db.select({
      id: files.id,
      name: files.name,
      type: files.type,
      size: files.size,
    })
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          inArray(files.id, fileIds),
          isNull(files.deletedAt)
        )
      );
  }

  /**
   * Get a single file by ID
   */
  async getById(fileId: string, userId: string): Promise<FileRow | null> {
    const result = await db.select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          eq(files.userId, userId),
          isNull(files.deletedAt)
        )
      )
      .limit(1);
    
    return result[0] || null;
  }

  /**
   * List files for a user with pagination
   */
  async listFiles(
    userId: string, 
    options: { skip: number; limit: number }
  ): Promise<FileListResult> {
    const where = and(isNull(files.deletedAt), eq(files.userId, userId));
    
    const [rows, totalResult] = await Promise.all([
      db.select({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        userId: files.userId,
      })
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt))
        .offset(options.skip)
        .limit(options.limit),
      db.select({ count: count() }).from(files).where(where),
    ]);
    
    return {
      files: rows,
      total: Number(totalResult[0]?.count ?? 0),
    };
  }

  /**
   * Create a new file record
   */
  async createFile(data: CreateFileInput): Promise<FileRow> {
    const [inserted] = await db.insert(files)
      .values(data)
      .returning({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        userId: files.userId,
      });
    
    return inserted;
  }

  /**
   * Soft delete a file
   */
  async softDelete(fileId: string, userId: string): Promise<boolean> {
    const result = await db.update(files)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.userId, userId),
          isNull(files.deletedAt)
        )
      )
      .returning({ id: files.id });

    return result.length > 0;
  }

  /**
   * Delete all file records for a user (for test teardown). Does not remove files from disk.
   */
  async deleteByUserId(userId: string): Promise<void> {
    await db.delete(files).where(eq(files.userId, userId));
  }

  /**
   * Get a file by ID only (for test assertions when userId is known in test).
   */
  async getByIdUnscoped(fileId: string): Promise<FileRow | null> {
    const result = await db.select({
      id: files.id,
      name: files.name,
      type: files.type,
      size: files.size,
      createdAt: files.createdAt,
      userId: files.userId,
    })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);
    return result[0] ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Link Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

