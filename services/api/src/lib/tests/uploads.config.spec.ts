import { describe, expect, test } from 'bun:test';

import { validateFileByMetadata } from '../uploads.config';

/** Helper: use a small valid size so type-validation tests are not affected by size checks. */
const VALID_SIZE = 100;

describe('validateFileByMetadata — type validation', () => {
  test('accepts files with exact MIME type match', () => {
    expect(validateFileByMetadata('doc.pdf', 'application/pdf', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.txt', 'text/plain', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.json', 'application/json', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.csv', 'text/csv', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.md', 'text/markdown', VALID_SIZE, 'general').isValid).toBe(true);
  });

  test('accepts files with application/octet-stream when extension is valid', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.csv', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.json', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.xml', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.tsv', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.pdf', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
    expect(validateFileByMetadata('doc.docx', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(true);
  });

  test('rejects files with unsupported extensions even with octet-stream', () => {
    expect(validateFileByMetadata('script.exe', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(false);
    expect(validateFileByMetadata('script.sh', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(false);
    expect(validateFileByMetadata('image.png', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(false);
    expect(validateFileByMetadata('archive.zip', 'application/octet-stream', VALID_SIZE, 'general').isValid).toBe(false);
  });

  test('rejects files with no filename or mimetype', () => {
    expect(validateFileByMetadata('', 'text/plain', VALID_SIZE, 'general').isValid).toBe(false);
    expect(validateFileByMetadata('doc.txt', '', VALID_SIZE, 'general').isValid).toBe(false);
  });

  test('rejects files with wrong MIME type for extension', () => {
    expect(validateFileByMetadata('doc.pdf', 'text/html', VALID_SIZE, 'general').isValid).toBe(false);
    expect(validateFileByMetadata('doc.txt', 'image/png', VALID_SIZE, 'general').isValid).toBe(false);
  });

  test('avatar validation still requires exact MIME type', () => {
    expect(validateFileByMetadata('photo.png', 'image/png', VALID_SIZE, 'avatar').isValid).toBe(true);
    expect(validateFileByMetadata('photo.png', 'application/octet-stream', VALID_SIZE, 'avatar').isValid).toBe(false);
  });
});

describe('validateFileByMetadata — size validation', () => {
  test('accepts valid file with octet-stream MIME', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', 100, 'general').isValid).toBe(true);
  });

  test('rejects empty files', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', 0, 'general').isValid).toBe(false);
  });

  test('rejects oversized files', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', 11 * 1024 * 1024, 'general').isValid).toBe(false);
  });

  test('rejects oversized avatar files', () => {
    expect(validateFileByMetadata('photo.png', 'image/png', 5 * 1024 * 1024, 'avatar').isValid).toBe(false);
  });

  test('accepts avatar files under size limit', () => {
    expect(validateFileByMetadata('photo.png', 'image/png', 3 * 1024 * 1024, 'avatar').isValid).toBe(true);
  });
});
