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
 * Đọc Credentials từ File hoặc Biến Môi Trường (CREDENTIALS_JSON)
 */
async function getCredentialsConfig() {
  if (process.env.CREDENTIALS_JSON) {
    try {
      return JSON.parse(process.env.CREDENTIALS_JSON);
    } catch (e) {
      console.error('Lỗi parse CREDENTIALS_JSON từ Environment Variable');
    }
  }
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Chưa cấu hình CREDENTIALS_JSON trên Server. Vui lòng thêm biến CREDENTIALS_JSON vào Railway Variables!');
  }
}

/**
 * Đọc Token từ File hoặc Biến Môi Trường (TOKEN_JSON)
 */
async function loadSavedCredentialsIfExist() {
  if (process.env.TOKEN_JSON) {
    try {
      const credentials = JSON.parse(process.env.TOKEN_JSON);
      return google.auth.fromJSON(credentials);
    } catch (e) {
      console.error('Lỗi parse TOKEN_JSON từ Environment Variable');
    }
  }
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
 * Thuật toán Regex bóc tách OTP thông minh (Xử lý chính xác các trường hợp như Droppii OTP: 908108)
 */
function extractOTP(text = '', subject = '', customRegex = '') {
  const combinedText = `${subject}\n${text}`;

  // 1. Regex tùy chỉnh nếu người dùng chỉ định
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

  // 2. Mẫu nhận diện chính xác từ khóa OTP đứng trước số
  // Xử lý tốt các mẫu như: "One Time Password (OTP): 908108" hoặc "Mã OTP là 123456"
  const specificOTPRegexes = [
    /(?:OTP|passcode|code|PIN|mã\s*xác\s*minh|mã\s*xác\s*thực)\s*[\):]*\s*[:=\s\-]*\s*([0-9]{4,8})\b/i,
    /\b(\d{6})\b/,           // Chuỗi 6 chữ số (ví dụ 908108)
    /\b(\d{4,8})\b/,          // Chuỗi 4-8 chữ số
    /\b([A-Z0-9]{6})\b/i
  ];

  for (const reg of specificOTPRegexes) {
    const match = combinedText.match(reg);
    if (match && match[1]) {
      const extracted = match[1].trim();
      // Loại trừ các con số năm (2024, 2025, 2026)
      if (/^(202[0-9])$/.test(extracted)) continue;
      return { code: extracted, reason: `Matched pattern: ${reg.toString()}` };
    }
  }

  // 3. Fallback
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
      message: error.message || 'Lỗi xử lý Gmail API. Hãy kiểm tra biến CREDENTIALS_JSON và TOKEN_JSON trên Railway!'
    });
  }
});

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`⚡ Gmail OTP Reader 1-Click Web App đang chạy tại:`);
  console.log(`👉 Port: ${PORT}`);
  console.log(`================================================`);
});
