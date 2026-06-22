/**
 * Integration tests for StorageController.
 * Tests file upload, list, download, and delete operations with mocked S3.
 */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { StorageController } from "../storage.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import { UserDatabaseAdapter, FileDatabaseAdapter } from "../../adapters/database.adapter";
import { StorageService } from "../../services/storage.service";

const uploadedFiles = new Map<string, Buffer>();

const mockStorage = {
  async uploadFile(buffer: Buffer, userId: string, fileId: string, extension: string, _contentType: string) {
    const key = `files/${userId}/${fileId}.${extension}`;
    uploadedFiles.set(key, buffer);
    return key;
  },
  async downloadFile(key: string) {
    const buffer = uploadedFiles.get(key);
    if (!buffer) throw new Error(`File not found: ${key}`);
    return buffer;
  },
  async uploadAvatar(buffer: Buffer, userId: string, extension: string, _contentType: string) {
    const key = `avatars/${userId}/mock.${extension}`;
    uploadedFiles.set(key, buffer);
    return key;
  },
  async uploadIndexImage(buffer: Buffer, userId: string, extension: string, _contentType: string) {
    const key = `index-images/${userId}/mock.${extension}`;
    uploadedFiles.set(key, buffer);
    return key;
  },
  async getPresignedUrl(key: string, expiresIn: number) {
    return `https://mock-s3.example.com/${key}?presigned=true&expires=${expiresIn}`;
  },
} as unknown as StorageService;

describe("StorageController Integration", () => {
  const controller = new StorageController(mockStorage);
  const userAdapter = new UserDatabaseAdapter();
  const fileAdapter = new FileDatabaseAdapter();
  let testUserId: string;
  let emptyListUserId: string;
  const testEmail = `test-storage-controller-${Date.now()}@example.com`;
  const emptyListEmail = `test-storage-controller-empty-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await fileAdapter.deleteByUserId(existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Storage User",
      intro: "Test user for storage controller",
      location: "Test City",
    });
    testUserId = user.id;

    const emptyUser = await userAdapter.create({
      email: emptyListEmail,
      name: "Empty List User",
      intro: "User with no files",
      location: "Test City",
    });
    emptyListUserId = emptyUser.id;
  });

  afterAll(async () => {
    uploadedFiles.clear();
    if (testUserId) {
      await fileAdapter.deleteByUserId(testUserId);
      await userAdapter.deleteById(testUserId);
    }
    if (emptyListUserId) {
      await fileAdapter.deleteByUserId(emptyListUserId);
      await userAdapter.deleteById(emptyListUserId);
    }
  });

  const getMockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Storage User",
  });

  describe("POST /storage/files (uploadFile)", () => {
    test("should return 400 when no file is uploaded", async () => {
      const formData = new FormData();
      const req = new Request("http://test/api/storage/files", {
        method: "POST",
        body: formData,
      });

      const result = await controller.uploadFile(req, getMockUser());

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe("No file uploaded");
    });

    test("should return 400 for unsupported file type", async () => {
      const file = new File(["binary content"], "script.exe", { type: "application/x-msdownload" });
      const formData = new FormData();
      formData.append("file", file);
      const req = new Request("http://test/api/storage/files", {
        method: "POST",
        body: formData,
      });

      const result = await controller.uploadFile(req, getMockUser());

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("not supported");
    });

    test("should upload a valid file and return file record", async () => {
      const content = "Hello, this is a test file for the storage controller.";
      const file = new File([content], "test-upload.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const req = new Request("http://test/api/storage/files", {
        method: "POST",
        body: formData,
      });

      const result = await controller.uploadFile(req, getMockUser());

      expect(result).not.toBeInstanceOf(Response);
      const data = result as { message: string; file: { id: string; name: string; size: string; type: string; url: string } };
      expect(data.message).toBe("File uploaded successfully");
      expect(data.file).toBeDefined();
      expect(data.file.id).toBeDefined();
      expect(data.file.name).toBe("test-upload.txt");
      expect(data.file.size).toBe(String(content.length));
      expect(data.file.type).toBe("text/plain");
      expect(data.file.url).toContain("files/");
    });
  });

  describe("GET /storage/files (listFiles)", () => {
    test("should return empty list when user has no files", async () => {
      const emptyUser: AuthenticatedUser = {
        id: emptyListUserId,
        email: emptyListEmail,
        name: "Empty List User",
      };
      const req = new Request("http://test/api/storage/files?page=1&limit=10");
      const result = await controller.listFiles(req, emptyUser);

      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("pagination");
      const data = result as { files: unknown[]; pagination: { current: number; totalCount: number } };
      expect(Array.isArray(data.files)).toBe(true);
      expect(data.files.length).toBe(0);
      expect(data.pagination.current).toBe(1);
      expect(data.pagination.totalCount).toBe(0);
    });

    test("should return uploaded files with pagination", async () => {
      const file = new File(["list test"], "list-me.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const uploadReq = new Request("http://test/api/storage/files", { method: "POST", body: formData });
      await controller.uploadFile(uploadReq, getMockUser());

      const listReq = new Request("http://test/api/storage/files?page=1&limit=10");
      const result = await controller.listFiles(listReq, getMockUser());

      const data = result as { files: Array<{ id: string; name: string; url: string }>; pagination: { current: number; totalCount: number } };
      expect(data.files.length).toBeGreaterThanOrEqual(1);
      const listFile = data.files.find((f) => f.name === "list-me.txt");
      expect(listFile).toBeDefined();
      expect(listFile!.url).toContain("files/");
      expect(data.pagination.current).toBe(1);
    });
  });

  describe("GET /storage/files/:id (downloadFile)", () => {
    test("should return 404 for non-existent file", async () => {
      const req = new Request("http://test/api/storage/files/00000000-0000-0000-0000-000000000000");
      const res = await controller.downloadFile(req, getMockUser(), { id: "00000000-0000-0000-0000-000000000000" });

      expect(res.status).toBe(404);
      const data = await res.json() as { error: string };
      expect(data.error).toBe("File not found");
    });

    test("should download uploaded file", async () => {
      const content = "Download me!";
      const file = new File([content], "download-test.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const uploadReq = new Request("http://test/api/storage/files", { method: "POST", body: formData });
      const uploadResult = await controller.uploadFile(uploadReq, getMockUser()) as { file: { id: string } };

      const req = new Request(`http://test/api/storage/files/${uploadResult.file.id}`);
      const res = await controller.downloadFile(req, getMockUser(), { id: uploadResult.file.id });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain");
      expect(res.headers.get("Content-Disposition")).toContain("download-test.txt");
      const body = await res.text();
      expect(body).toBe(content);
    });
  });

  describe("DELETE /storage/files/:id (deleteFile)", () => {
    test("should return 404 for non-existent file", async () => {
      const req = new Request("http://test/api/storage/files/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
      const res = await controller.deleteFile(req, getMockUser(), { id: "00000000-0000-0000-0000-000000000000" });

      expect(res.status).toBe(404);
      const data = await res.json() as { error: string };
      expect(data.error).toBe("File not found");
    });

    test("should soft-delete an existing file", async () => {
      const file = new File(["delete me"], "to-delete.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const uploadReq = new Request("http://test/api/storage/files", { method: "POST", body: formData });
      const uploadResult = await controller.uploadFile(uploadReq, getMockUser()) as { file: { id: string } };

      const req = new Request(`http://test/api/storage/files/${uploadResult.file.id}`, { method: "DELETE" });
      const res = await controller.deleteFile(req, getMockUser(), { id: uploadResult.file.id });

      expect(res.status).toBe(200);
      const data = await res.json() as { success: boolean };
      expect(data.success).toBe(true);
    });
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

      // Parse userId and filename from avatarUrl (format: avatars/userId/filename.ext)
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

      // Parse userId and filename from imageUrl (format: index-images/userId/filename.ext)
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
