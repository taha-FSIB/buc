/**
 * Sending email.
 *
 * Email is a convenience here, not the backbone. This batch lives on WhatsApp,
 * and several members have an address they set up once in 2009 and have not
 * opened since. So every link this module can send can also be copied out of
 * the admin screens and pasted into a chat by hand.
 *
 * That shapes the contract below: when no provider is configured, nothing
 * pretends to have been sent. The caller is told plainly, and the screens say
 * "ask on WhatsApp" instead of "check your inbox". A message that never
 * arrives, in a spam folder a 72-year-old will never find, is worse than no
 * message at all.
 *
 * The provider is Resend, chosen because it is one HTTPS POST with no SDK and
 * therefore nothing to break inside a Worker. Swapping it for another provider
 * means changing `deliver()` and nothing else.
 */

export interface MailEnv {
  SITE_NAME: string;
  SITE_URL?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

export function emailConfigured(env: MailEnv): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

export type SendResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'failed'; detail?: string };

/**
 * The origin to build links against.
 *
 * `SITE_URL` wins when it is set. Falling back to the request's own origin is
 * convenient in development but must not be relied on in production: an
 * attacker who can set the Host header could otherwise have a real member
 * emailed a real token pointing at a site they control. Set SITE_URL before
 * going live — the deploy checklist in the README says so too.
 */
export function siteOrigin(env: MailEnv, requestUrl: string): string {
  const configured = env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(requestUrl).origin;
}

async function deliver(
  env: MailEnv,
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<SendResult> {
  if (!emailConfigured(env)) return { sent: false, reason: 'not_configured' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Email delivery failed:', res.status, detail);
      return { sent: false, reason: 'failed', detail: `${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('Email delivery threw:', err);
    return { sent: false, reason: 'failed' };
  }
}

/**
 * One large button, one plain fallback URL, no images, no tracking pixel.
 * Inline styles because email clients discard a <style> block, and a generous
 * font size because this will be read on a phone held at arm's length.
 */
function shell(heading: string, lines: string[], url: string, cta: string): string {
  const paragraphs = lines
    .map((l) => `<p style="margin:0 0 16px">${l}</p>`)
    .join('');

  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.6;color:#1c1917;background:#fffbeb;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:2px solid #e7e0cf;border-radius:12px;padding:28px">
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 20px;color:#1c1917">${heading}</h1>
    ${paragraphs}
    <p style="margin:28px 0">
      <a href="${url}" style="display:block;text-align:center;background:#9a3412;color:#ffffff;text-decoration:none;font-size:19px;font-weight:bold;padding:18px 24px;border-radius:10px">${cta}</a>
    </p>
    <p style="margin:0 0 8px;font-size:16px;color:#57534e">If the button does not work, copy this address into your browser:</p>
    <p style="margin:0;font-size:15px;word-break:break-all;color:#57534e">${url}</p>
  </div>
</div>`;
}

export function sendSignInLink(
  env: MailEnv,
  to: string,
  name: string,
  url: string,
): Promise<SendResult> {
  const heading = `Your link to sign in, ${name}`;
  const lines = [
    'Tap the button below and you will be signed in. There is no password to remember.',
    'The link works once, and stops working after a day. If you did not ask for it, you can ignore this — nobody can get in without it.',
  ];

  const text = [
    heading,
    '',
    'Open this address to sign in:',
    url,
    '',
    'It works once, and stops working after a day.',
  ].join('\n');

  return deliver(env, to, `Sign in to ${env.SITE_NAME}`, text,
    shell(heading, lines, url, 'Sign me in'));
}

export function sendInviteLink(
  env: MailEnv,
  to: string,
  name: string,
  url: string,
  code: string,
): Promise<SendResult> {
  const heading = `Welcome back, ${name}`;
  const lines = [
    'The pioneer batch of Batticaloa University College now has a home of its own — a place for our photographs, our stories, and each other.',
    'Tap the button to come in. There is no password to set up.',
    `If you would rather type something in, your invitation code is <strong>${code}</strong>.`,
  ];

  const text = [
    heading,
    '',
    'Open this address to come in:',
    url,
    '',
    `Or use your invitation code: ${code}`,
  ].join('\n');

  return deliver(env, to, `You are invited to ${env.SITE_NAME}`, text,
    shell(heading, lines, url, 'Come in'));
}
