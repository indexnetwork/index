#!/usr/bin/env bun
/**
 * Reproduces the dotenv preamble used by services/api/src/cli/db-seed.ts and
 * db-flush.ts, then prints the effective DATABASE_URL. Connects to nothing.
 *
 * Both CLIs open with, before any database module is imported:
 *
 *   import dotenv from 'dotenv';
 *   import path from 'path';
 *   const envFile = `.env.development`;
 *   dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });
 *   import db from '../lib/drizzle/drizzle';
 *
 * The only difference here is that the directory holding `.env.development` is
 * taken from argv[2] instead of being resolved to the repository root, so the
 * probe reads a throwaway file rather than the real developer environment.
 * Everything that decides the outcome — the dotenv version, the absence of
 * `override`, and reading process.env after the config call but before the
 * database module would be imported — is identical.
 */
import dotenv from "dotenv";
import path from "node:path";

const envFile = ".env.development";
dotenv.config({ path: path.resolve(process.argv[2], envFile) });

console.log(process.env.DATABASE_URL ?? "unset");
