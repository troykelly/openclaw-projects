import { getPostmarkTransactionalToken, sendPostmarkEmail } from './postmark.js';

const DEFAULT_FROM = 'Projects <projects@execdesk.ai>';
const DEFAULT_REPLY_TO = 'quasar@execdesk.ai';

export type SendMagicLinkArgs = {
  toEmail: string;
  loginUrl: string;
};

export async function sendMagicLinkEmail(args: SendMagicLinkArgs): Promise<{ delivered: boolean; error?: string }> {
  // Avoid sending real email during unit tests unless explicitly enabled.
  if (process.env.NODE_ENV === 'test' && process.env.POSTMARK_ENABLE_TEST_SEND !== '1') {
    return { delivered: false };
  }

  const token = await getPostmarkTransactionalToken();
  if (!token) {
    console.warn('[Postmark] No transactional token configured - email will not be sent');
    return { delivered: false, error: 'no_token' };
  }

  const subject = 'Your ExecDesk dashboard login link';
  const textBody = `Use this link to sign in (valid for 15 minutes):\n\n${args.loginUrl}\n\nIf you did not request this, you can ignore this email.`;
  const htmlBody = `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif;">
    <p>Use this link to sign in (valid for 15 minutes):</p>
    <p><a href="${escapeHtmlAttr(args.loginUrl)}">Sign in to the dashboard</a></p>
    <p style="color:#666; font-size: 13px;">If you did not request this, you can ignore this email.</p>
  </body>
</html>`;

  try {
    await sendPostmarkEmail(token, {
      From: process.env.POSTMARK_FROM || DEFAULT_FROM,
      To: args.toEmail,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      ReplyTo: process.env.POSTMARK_REPLY_TO || DEFAULT_REPLY_TO,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
    });
    console.log(`[Postmark] Magic link email sent to ${args.toEmail}`);
    return { delivered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Postmark] Failed to send magic link email to ${args.toEmail}: ${message}`);
    return { delivered: false, error: message };
  }
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
