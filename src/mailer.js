// "Send to web@sport5.co.il" without opening Outlook: the page posts the story to the feedback channel, and the
// collector (every ~5 minutes) sends it from the radar's own Gmail account. The recipient is fixed here, never taken
// from the message, so the public channel can't be used to mail anyone else.
// Needs two GitHub secrets: GMAIL_USER (the address) and GMAIL_APP_PASSWORD (a Google "app password").
// Without them nothing is sent and the page keeps opening the editor's own mail program, as before.
// A tiny SMTP client over TLS (Node's own tls module): no extra package.

import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

export const MAIL_TO = 'web@sport5.co.il';
const PER_RUN = 15;
const PER_DAY = 150; // all devices together
const MAX_TRIES = 3;
const MAX_AGE = 2 * 3600e3; // a mail still not sent after 2 hours is dropped

export const mailEnabled = (env = process.env) => !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);

// =?UTF-8?B?…?= words of at most 45 bytes each (never splitting a character), for Hebrew headers
export function encodeHeader(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let cur = '';
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 45) {
      words.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

export function buildMessage({ from, fromName, to, subject, text, now = Date.now() }) {
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@sports-radar>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

// One SMTP conversation. connect() returns a duplex socket (TLS to Gmail by default; tests pass a plain one).
export async function smtpSend({ user, pass, to, message, host = 'smtp.gmail.com', port = 465, connect, timeoutMs = 20000 }) {
  const sock = connect ? connect() : tls.connect({ host, port, servername: host });
  sock.setEncoding('utf8');
  let buf = '';
  let lines = [];
  const replies = [];
  const waiters = [];
  let failed = null;
  const fail = (e) => {
    failed = failed || e;
    while (waiters.length) waiters.shift().reject(failed);
  };
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const r = { code: Number(line.slice(0, 3)), text: lines.join(' | ') };
        lines = [];
        if (waiters.length) waiters.shift().resolve(r);
        else replies.push(r);
      }
    }
  });
  sock.on('error', (e) => fail(new Error(`SMTP connection: ${e.code || e.message}`)));
  sock.on('close', () => fail(new Error('SMTP connection closed')));
  const timer = setTimeout(() => {
    fail(new Error('SMTP timeout'));
    sock.destroy();
  }, timeoutMs);
  const read = () => (replies.length ? Promise.resolve(replies.shift()) : failed ? Promise.reject(failed) : new Promise((resolve, reject) => waiters.push({ resolve, reject })));
  // the reply text goes into errors; the commands (which hold the password) never do
  const step = async (cmd, want, label) => {
    if (cmd != null) sock.write(cmd + '\r\n');
    const r = await read();
    if (r.code !== want) throw new Error(`SMTP ${label}: ${r.text.slice(0, 200)}`);
    return r;
  };
  try {
    await step(null, 220, 'greeting');
    await step('EHLO sports-radar', 250, 'EHLO');
    await step(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, 235, 'login');
    await step(`MAIL FROM:<${user}>`, 250, 'sender');
    await step(`RCPT TO:<${to}>`, 250, 'recipient');
    await step('DATA', 354, 'DATA');
    // base64 bodies never start a line with ".", headers are ours: no dot-stuffing needed
    await step(`${message}\r\n.`, 250, 'send');
    sock.write('QUIT\r\n');
  } finally {
    clearTimeout(timer);
    sock.end();
  }
}

// prev = { day, count, queue: [{ title, text, name, at, tries }], error, errorDay }
// requests come from the feedback channel (already limited per device there)
export async function sendMails(prev = {}, requests = [], now = Date.now(), { env = process.env, send = smtpSend } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const st = { day, count: prev.day === day ? prev.count || 0 : 0, queue: [...(prev.queue || []), ...requests].filter((m) => now - m.at < MAX_AGE && (m.tries || 0) < MAX_TRIES), error: null, errorDay: prev.errorDay || null };
  if (!mailEnabled(env)) return { mail: { ...st, queue: [] }, sent: 0, newError: null };
  let sent = 0;
  const keep = [];
  for (const m of st.queue) {
    if (sent >= PER_RUN || st.count >= PER_DAY || st.error) {
      keep.push(m);
      continue;
    }
    try {
      const text = `${m.text}\n\n— נשלח מרדאר ספורט${m.name ? ` ע״י ${m.name}` : ''}`;
      const message = buildMessage({ from: env.GMAIL_USER, fromName: 'רדאר ספורט', to: MAIL_TO, subject: m.title || 'רדאר ספורט', text, now });
      await send({ user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD, to: MAIL_TO, message });
      sent++;
      st.count++;
    } catch (e) {
      st.error = String(e.message || e).slice(0, 200); // stop this run: a login problem would fail every mail
      if ((m.tries || 0) + 1 < MAX_TRIES) keep.push({ ...m, tries: (m.tries || 0) + 1 });
    }
  }
  st.queue = keep;
  // the admin hears about a failing mailbox once a day
  const newError = st.error && st.errorDay !== day ? st.error : null;
  if (newError) st.errorDay = day;
  return { mail: st, sent, newError };
}
