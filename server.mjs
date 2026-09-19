import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';

const app = express();
const PORT = process.env.PORT || 3000;

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

/**
 * Tự động tạo tệp physical credentials.json và token.json trên Server Cloud nếu có biến môi trường
 */
async function initEnvFiles() {
  if (process.env.CREDENTIALS_JSON) {
    try {
      await fs.writeFile(CREDENTIALS_PATH, process.env.CREDENTIALS_JSON, 'utf-8');
      console.log('✅ Đã khởi tạo tệp credentials.json từ CREDENTIALS_JSON Environment Variable!');
    } catch (e) {
      console.error('Lỗi khởi tạo credentials.json:', e.message);
    }
  }
  if (process.env.TOKEN_JSON) {
    try {
      await fs.writeFile(TOKEN_PATH, process.env.TOKEN_JSON, 'utf-8');
      console.log('✅ Đã khởi tạo tệp token.json từ TOKEN_JSON Environment Variable!');
    } catch (e) {
      console.error('Lỗi khởi tạo token.json:', e.message);
    }
  }
}

/**
 * Đọc Credentials
 */
async function getCredentialsConfig() {
  await initEnvFiles();
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Chưa tìm thấy tệp credentials.json hoặc biến CREDENTIALS_JSON trên Railway!');
  }
}

/**
 * Đọc Token
 */
async function loadSavedCredentialsIfExist() {
  await initEnvFiles();
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Lưu token để tái sử dụng
 */
async function saveCredentials(client) {
  try {
    const keys = await getCredentialsConfig();
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

/**
 * Ủy quyền OAuth2
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  
  await getCredentialsConfig();
  
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
 * Giải mã body (base64url)
 */
function getPlainText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
    return html.replace(/<[^>]*>/g, ' ');
  }
  for (const child of part?.parts ?? []) {
    const text = getPlainText(child);
    if (text) return text;
  }
  return '';
}

/**
 * Thuật toán Regex bóc tách OTP thông minh (Trích xuất chính xác 908108 cho Droppii OTP)
 */
function extractOTP(text = '', subject = '', customRegex = '') {
  const combinedText = `${subject}\n${text}`;

  if (customRegex && customRegex.trim()) {
    try {
      const reg = new RegExp(customRegex.trim(), 'i');
      const match = combinedText.match(reg);
      if (match) {
        const code = match[1] || match[0];
        return { code: code.trim(), reason: 'Custom Regex Pattern' };
      }
    } catch (e) {}
  }

  const specificOTPRegexes = [
    /(?:OTP|passcode|code|PIN|mã\s*xác\s*minh|mã\s*xác\s*thực)\s*[\):]*\s*[:=\s\-]*\s*([0-9]{4,8})\b/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/,
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
    return { code: fallbackMatch[0], reason: 'Fallback number' };
  }

  return { code: null, reason: 'No OTP code' };
}

// API Endpoint 1-Click Lấy Mã OTP
app.post('/api/get-otp', async (req, res) => {
  try {
    const { senderFilter, subjectFilter, customRegex } = req.body || {};
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });

    let queryParts = ['in:inbox'];
    if (senderFilter && senderFilter.trim()) queryParts.push(`from:${senderFilter.trim()}`);
    if (subjectFilter && subjectFilter.trim()) queryParts.push(`subject:"${subjectFilter.trim()}"`);
    const q = queryParts.join(' ');

    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: q,
      maxResults: 5,
    });

    if (!data.messages || data.messages.length === 0) {
      return res.json({
        success: false,
        message: `Không tìm thấy email nào trong Inbox khớp với bộ lọc (Query: "${q}")`
      });
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
      const textBody = getPlainText(mail.payload) || mail.snippet || '';

      const otpResult = extractOTP(textBody, subject, customRegex);

      if (otpResult.code) {
        foundOTP = {
          code: otpResult.code,
          reason: otpResult.reason,
          subject,
          from,
          date,
          snippet: mail.snippet,
          htmlBody: textBody
        };
        break;
      }
    }

    if (!foundOTP) {
      return res.json({
        success: false,
        message: 'Đã đọc các thư gần nhất nhưng không nhận diện được chuỗi mã OTP nào.'
      });
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...foundOTP
    });
  } catch (error) {
    console.error('API Error:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi xử lý Gmail API'
    });
  }
});

app.listen(PORT, async () => {
  await initEnvFiles();
  console.log(`================================================`);
  console.log(`⚡ Gmail OTP Reader 1-Click Web App đang chạy tại:`);
  console.log(`👉 Port: ${PORT}`);
  console.log(`================================================`);
});
