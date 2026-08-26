/**
 * Integration tests for StorageController.
 * Tests avatar and index image upload/serve with mocked S3.
 */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll as bunBeforeAll, afterAll as bunAfterAll } from "bun:test";
import { StorageController } from "../storage.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { StorageService } from "../../services/storage.service";
import { withMinimumDatabaseHookBudget } from "../../lib/testing/database-test-budget";

const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

type StoredObject = {
  buffer: Buffer;
  contentType: string;
  createdAt: Date;
};

const uploadedFiles = new Map<string, StoredObject>();

const mockStorageAdapter = {
  async downloadFile(key: string) {
    const stored = uploadedFiles.get(key);
    if (!stored) throw new Error(`File not found: ${key}`);
    return stored.buffer;
  },
  async uploadAvatar(buffer: Buffer, userId: string, extension: string, contentType: string) {
    const key = `avatars/${userId}/mock.${extension}`;
    uploadedFiles.set(key, { buffer, contentType, createdAt: new Date() });
    return key;
  },
  async uploadIndexImage(buffer: Buffer, userId: string, extension: string, contentType: string) {
    const key = `index-images/${userId}/mock.${extension}`;
    uploadedFiles.set(key, { buffer, contentType, createdAt: new Date() });
    return key;
  },
};

const mockStorage = new StorageService(mockStorageAdapter);

describe("StorageController Integration", () => {
  const controller = new StorageController(mockStorage);
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  const testEmail = `test-storage-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Storage User",
      intro: "Test user for storage controller",
      location: "Test City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    uploadedFiles.clear();
    if (testUserId) {
      await userAdapter.deleteById(testUserId);
    }
  });

  const getMockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Storage User",
  });

  describe("POST /storage/avatars (uploadAvatar)", () => {
    test("should upload avatar and return S3 key", async () => {
      const imageBuffer = Buffer.from("fake-image-data");
      const file = new File([imageBuffer], "avatar.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("avatar", file);
      const req = new Request("http://test/api/storage/avatars", { method: "POST", body: formData });

      const result = await controller.uploadAvatar(req, getMockUser());

      expect(result).not.toBeInstanceOf(Response);
      const data = result as { message: string; avatarUrl: string };
      expect(data.message).toBe("Avatar uploaded successfully");
      expect(data.avatarUrl).toContain("avatars/");
    });
  });

  describe("POST /storage/index-images (uploadIndexImage)", () => {
    test("should upload index image and return S3 key", async () => {
      const imageBuffer = Buffer.from("fake-image-data");
      const file = new File([imageBuffer], "index-image.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("image", file);
      const req = new Request("http://test/api/storage/index-images", { method: "POST", body: formData });

      const result = await controller.uploadIndexImage(req, getMockUser());

      expect(result).not.toBeInstanceOf(Response);
      const data = result as { message: string; imageUrl: string };
      expect(data.message).toBe("Index image uploaded successfully");
      expect(data.imageUrl).toContain("index-images/");
    });
  });

  describe("GET /storage/avatars/:userId/:filename (serveAvatar)", () => {
    test("should stream avatar content", async () => {
      const imageContent = "fake-avatar-image-data";
      const imageBuffer = Buffer.from(imageContent);
      const file = new File([imageBuffer], "test-avatar.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("avatar", file);
      const uploadReq = new Request("http://test/api/storage/avatars", { method: "POST", body: formData });
      const uploadResult = await controller.uploadAvatar(uploadReq, getMockUser()) as { avatarUrl: string };

      const parts = uploadResult.avatarUrl.split('/');
      const userId = parts[1];
      const filename = parts[2];

      const req = new Request(`http://test/api/storage/avatars/${userId}/${filename}`);
      const res = await controller.serveAvatar(req, null, { userId, filename });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toContain("public");
    });

    test("should return 404 for non-existent file", async () => {
      const req = new Request("http://test/api/storage/avatars/nonexistent/file.png");
      const res = await controller.serveAvatar(req, null, { userId: "nonexistent", filename: "file.png" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /storage/index-images/:userId/:filename (serveIndexImage)", () => {
    test("should stream index image content", async () => {
      const imageContent = "fake-index-image-data";
      const imageBuffer = Buffer.from(imageContent);
      const file = new File([imageBuffer], "test-index.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("image", file);
      const uploadReq = new Request("http://test/api/storage/index-images", { method: "POST", body: formData });
      const uploadResult = await controller.uploadIndexImage(uploadReq, getMockUser()) as { imageUrl: string };

      const parts = uploadResult.imageUrl.split('/');
      const userId = parts[1];
      const filename = parts[2];

      const req = new Request(`http://test/api/storage/index-images/${userId}/${filename}`);
      const res = await controller.serveIndexImage(req, null, { userId, filename });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toContain("public");
    });
  });
});
