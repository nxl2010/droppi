import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
  } catch (err) {}
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client && client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Thuật toán Regex bóc tách OTP thông minh (Xử lý chính xác các trường hợp như Droppii OTP: 908108)
 */
function extractOTP(text = '', subject = '') {
  const combinedText = `${subject}\n${text}`;

  const specificOTPRegexes = [
    /(?:OTP|passcode|code|PIN|mã\s*xác\s*minh|mã\s*xác\s*thực)\s*[\):]*\s*[:=\s\-]*\s*([0-9]{4,8})\b/i,
    /\b(\d{6})\b/,           // 6 chữ số (ví dụ 908108)
    /\b(\d{4,8})\b/,          // 4-8 chữ số
    /\b([A-Z0-9]{6})\b/i
  ];

  for (const reg of specificOTPRegexes) {
    const match = combinedText.match(reg);
    if (match && match[1]) {
      const extracted = match[1].trim();
      if (/^(202[0-9])$/.test(extracted)) continue;
      return { code: extracted, reason: `Matched pattern: ${reg.toString()}` };
    }
  }

  const fallbackMatch = combinedText.match(/\b\d{4,8}\b/);
  if (fallbackMatch) {
    return { code: fallbackMatch[0], reason: 'Fallback number pattern' };
  }

  return { code: null, reason: 'No OTP code' };
}

function getPlainText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = Buffer.from(part.body.data, 'base64url').toString('utf8');
    return html.replace(/<[^>]*>/g, ' ');
  }
  for (const child of part?.parts ?? []) {
    const text = getPlainText(child);
    if (text) return text;
  }
  return '';
}

async function main() {
  console.log('🚀 Đang kết nối Gmail API...');
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  const query = 'in:inbox';

  console.log(`🔎 Đang tìm kiếm thư mới nhất trong Inbox (Query: "${query}")...`);
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 5,
  });

  if (!data.messages || data.messages.length === 0) {
    console.log('⚠️ Không tìm thấy email nào trong hòm thư Inbox.');
    return;
  }

  let foundOTP = null;

  for (const item of data.messages) {
    const { data: mail } = await gmail.users.messages.get({
      userId: 'me',
      id: item.id,
      format: 'full',
    });

    const headers = mail.payload?.headers || [];
    const getHeader = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const subject = getHeader('subject') || '(Không có tiêu đề)';
    const from = getHeader('from') || 'Unknown';
    const date = getHeader('date') || '';

    const content = getPlainText(mail.payload) || mail.snippet || '';
    const otpResult = extractOTP(content, subject);

    if (otpResult.code) {
      foundOTP = {
        code: otpResult.code,
        reason: otpResult.reason,
        subject,
        from,
        date,
        snippet: mail.snippet
      };
      break;
    }
  }

  console.log('\n==================================================');
  if (foundOTP) {
    console.log(`✨ MÃ OTP LẤY ĐƯỢC:  >>>  ${foundOTP.code}  <<<`);
    console.log('==================================================');
    console.log(`👤 Người gửi  : ${foundOTP.from}`);
    console.log(`📧 Tiêu đề    : ${foundOTP.subject}`);
    console.log(`⏱️  Thời gian  : ${foundOTP.date}`);
    console.log(`💡 Phương thức: ${foundOTP.reason}`);
    console.log(`📝 Xem trước   : ${foundOTP.snippet}`);
  } else {
    console.log('❌ Đã đọc các thư gần nhất nhưng không phát hiện mã OTP nào.');
  }
  console.log('==================================================\n');
}

main().catch(console.error);
