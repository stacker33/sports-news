import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { encodeHeader, buildMessage, smtpSend, sendMails, MAIL_TO, mailEnabled } from '../src/mailer.js';

const decodeWords = (h) => h.split('\r\n ').map((w) => Buffer.from(w.match(/^=\?UTF-8\?B\?(.*)\?=$/)[1], 'base64').toString()).join('');

test('Hebrew headers are encoded in short words that never split a character', () => {
  const subject = 'רשמית: ברק יצחקי מונה למאמן אנורתוזיס פמגוסטה, ובקבוצה כבר מדברים על האליפות';
  const h = encodeHeader(subject);
  assert.equal(decodeWords(h), subject);
  for (const w of h.split('\r\n ')) assert.ok(w.length <= 75, w);
  assert.equal(encodeHeader('Plain ASCII'), 'Plain ASCII');
});

test('the message is UTF-8 base64 with a fixed sender name', () => {
  const m = buildMessage({ from: 'radar@example.com', fromName: 'רדאר ספורט', to: MAIL_TO, subject: 'כותרת', text: 'שורה 1\nשורה 2' });
  const [head, body] = m.split('\r\n\r\n');
  assert.match(head, /^From: =\?UTF-8\?B\?.+\?= <radar@example.com>/m);
  assert.match(head, /^To: <web@sport5.co.il>$/m);
  assert.match(head, /^Content-Transfer-Encoding: base64$/m);
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString(), 'שורה 1\r\nשורה 2');
});

// a fake SMTP server speaking just enough of the protocol
function fakeSmtp({ authOk = true } = {}) {
  const got = { cmds: [], data: '' };
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('220 fake ESMTP\r\n');
    let inData = false;
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 queued\r\n');
          } else got.data += line + '\r\n';
          continue;
        }
        got.cmds.push(line);
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) sock.write(authOk ? '235 ok\r\n' : '535 5.7.8 Username and Password not accepted\r\n');
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) sock.write('250 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, got, port: server.address().port })));
}

test('one SMTP conversation: login, fixed recipient, the message', async () => {
  const { server, got, port } = await fakeSmtp();
  try {
    const message = buildMessage({ from: 'radar@example.com', fromName: 'רדאר', to: MAIL_TO, subject: 'Test', text: 'hello' });
    await smtpSend({ user: 'radar@example.com', pass: 'app-pass', to: MAIL_TO, message, connect: () => net.connect(port, '127.0.0.1') });
    assert.ok(got.cmds.includes('RCPT TO:<web@sport5.co.il>'));
    assert.equal(Buffer.from(got.cmds.find((c) => c.startsWith('AUTH PLAIN')).slice(11), 'base64').toString(), '\0radar@example.com\0app-pass');
    assert.match(got.data, /^Subject: Test$/m);
  } finally {
    server.close();
  }
});

test('a rejected login fails with the server reply, never the password', async () => {
  const { server, port } = await fakeSmtp({ authOk: false });
  try {
    await assert.rejects(
      smtpSend({ user: 'radar@example.com', pass: 'secret-app-pass', to: MAIL_TO, message: 'x', connect: () => net.connect(port, '127.0.0.1') }),
      (e) => /535/.test(e.message) && !e.message.includes('secret-app-pass') && !e.message.includes(Buffer.from('\0radar@example.com\0secret-app-pass').toString('base64'))
    );
  } finally {
    server.close();
  }
});

const env = { GMAIL_USER: 'radar@example.com', GMAIL_APP_PASSWORD: 'x' };
const now = Date.parse('2026-10-23T10:00:00Z');
const req = (title, at = now - 60e3) => ({ title, text: `text of ${title}`, name: 'דני', at });

test('without the mailbox secrets nothing is sent or kept', async () => {
  assert.equal(mailEnabled({}), false);
  let calls = 0;
  const { mail, sent } = await sendMails({}, [req('a')], now, { env: {}, send: async () => calls++ });
  assert.equal(sent, 0);
  assert.equal(calls, 0);
  assert.deepEqual(mail.queue, []);
});

test('mails go to web@sport5.co.il only, signed with the editor name; a daily cap holds', async () => {
  const seen = [];
  const { mail, sent } = await sendMails({}, [req('a'), { ...req('b'), to: 'someone@else.com' }], now, { env, send: async (o) => seen.push(o) });
  assert.equal(sent, 2);
  assert.ok(seen.every((o) => o.to === MAIL_TO));
  const body = Buffer.from(seen[0].message.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString();
  assert.match(body, /ע״י דני/);
  assert.equal(mail.count, 2);
  const capped = await sendMails({ day: '2026-10-23', count: 150 }, [req('c')], now, { env, send: async () => assert.fail('over the cap') });
  assert.equal(capped.sent, 0);
  assert.equal(capped.mail.queue.length, 1); // waits for tomorrow (or is dropped after 2 hours)
});

test('a failing mailbox keeps the mails for the next runs and tells the admin once a day', async () => {
  const fail = async () => {
    throw new Error('SMTP login: 535 bad credentials');
  };
  const r1 = await sendMails({}, [req('a'), req('b')], now, { env, send: fail });
  assert.equal(r1.sent, 0);
  assert.equal(r1.mail.queue.length, 2);
  assert.match(r1.newError, /535/);
  const r2 = await sendMails(r1.mail, [], now + 300e3, { env, send: fail });
  assert.equal(r2.newError, null); // already told today
  const r3 = await sendMails(r2.mail, [], now + 600e3, { env, send: fail });
  assert.equal(r3.mail.queue.length, 1); // "a" failed 3 times and is dropped; "b" was never tried past the first failure
  const old = await sendMails({}, [req('old', now - 3 * 3600e3)], now, { env, send: async () => assert.fail('too old') });
  assert.equal(old.sent, 0);
});
