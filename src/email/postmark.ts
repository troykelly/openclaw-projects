import { readFile } from 'node:fs/promises';

export type PostmarkEmail = {
  From: string;
  To: string;
  Subject: string;
  TextBody?: string;
  HtmlBody?: string;
  ReplyTo?: string;
  MessageStream?: string;
};

export type PostmarkSendResult = {
  To: string;
  SubmittedAt: string;
  MessageID: string;
  ErrorCode: number;
  Message: string;
};

const DEFAULT_TOKEN_FILE = '/home/clawdbot/.postmark_transactional_token';

export async function getPostmarkTransactionalToken(): Promise<string | null> {
  if (process.env.POSTMARK_TRANSACTIONAL_TOKEN && process.env.POSTMARK_TRANSACTIONAL_TOKEN.trim()) {
    return process.env.POSTMARK_TRANSACTIONAL_TOKEN.trim();
  }

  const tokenFile = process.env.POSTMARK_TRANSACTIONAL_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  try {
    const token = (await readFile(tokenFile, 'utf-8')).trim();
    return token.length ? token : null;
  } catch {
    return null;
  }
}

export async function sendPostmarkEmail(
  token: string,
  email: PostmarkEmail
): Promise<PostmarkSendResult> {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify(email),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Postmark send failed (${res.status}): ${body || res.statusText}`);
  }

  return (await res.json()) as PostmarkSendResult;
}
