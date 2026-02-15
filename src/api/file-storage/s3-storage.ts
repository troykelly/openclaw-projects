/**
 * S3-compatible file storage implementation.
 * Part of Issue #215.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { FileStorage, S3Config } from './types.ts';

/**
 * S3-compatible storage implementation.
 * Works with AWS S3 and SeaweedFS.
 */
export class S3Storage implements FileStorage {
  private client: S3Client;
  private externalClient: S3Client | null = null;
  private bucket: string;
  private config: S3Config;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.config = config;

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
    });
  }

  /**
   * Upload a file to S3
   */
  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );

    return key;
  }

  /**
   * Download a file from S3
   */
  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`Empty body for key: ${key}`);
    }

    const chunks: Uint8Array[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Get a signed URL for temporary access
   */
  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return s3GetSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Get a signed URL using the external endpoint for browser-facing presigned URLs.
   * Uses a separate S3Client configured with the external endpoint so that the
   * Signature V4 Host header matches the endpoint the browser actually hits.
   * Falls back to the internal client when no external endpoint is configured.
   */
  async getExternalSignedUrl(key: string, expiresIn: number): Promise<string> {
    const signingClient = this.getExternalClient();

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return s3GetSignedUrl(signingClient, command, { expiresIn });
  }

  /**
   * Get or lazily create the external S3Client for presigning.
   * Returns the internal client if no external endpoint is configured.
   */
  private getExternalClient(): S3Client {
    if (!this.config.externalEndpoint) {
      return this.client;
    }

    if (!this.externalClient) {
      this.externalClient = new S3Client({
        endpoint: this.config.externalEndpoint,
        region: this.config.region,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
        forcePathStyle: this.config.forcePathStyle ?? !!this.config.externalEndpoint,
      });
    }

    return this.externalClient;
  }

  /**
   * Delete a file from S3
   */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /**
   * Check if a file exists in S3
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}

/**
 * Create S3Storage from environment variables
 */
export function createS3StorageFromEnv(): S3Storage | null {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Storage({
    endpoint: process.env.S3_ENDPOINT,
    externalEndpoint: process.env.S3_EXTERNAL_ENDPOINT,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
}
