import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

// Download and configure Russian Trusted Root CA
const certPath = path.join(os.tmpdir(), 'russian_trusted_root_ca.crt');
const downloadCert = async () => {
  try {
    if (!fs.existsSync(certPath)) {
      console.log("Downloading Russian Trusted Root CA...");
      const response = await axios.get('https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt', {
        responseType: 'arraybuffer'
      });
      fs.writeFileSync(certPath, response.data);
      console.log("Certificate downloaded to:", certPath);
    }
    process.env.NODE_EXTRA_CA_CERTS = certPath;
    // Still keep this as a fallback for some environments
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; 
  } catch (e) {
    console.error("Failed to download Russian Trusted Root CA:", e);
  }
};

// Start download in background
downloadCert();

// Disable SSL verification for GigaChat (self-signed certs)
const agent = new https.Agent({
  rejectUnauthorized: false,
});

// Create axios instance for GigaChat
const gigaClient = axios.create({
  httpsAgent: agent,
  timeout: 60000,
});

export class GigaChatService {
  private apiKey: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const rquid = uuidv4();
    
    // Clean the key
    let cleanKey = this.apiKey.trim();
    
    // Regex to strip 'Basic' prefix (case-insensitive, with optional spaces)
    const basicRegex = /^basic\s*/i;
    if (basicRegex.test(cleanKey)) {
      cleanKey = cleanKey.replace(basicRegex, '').trim();
    }
    
    // If it contains a colon, it's likely 'client_id:client_secret', so encode it
    if (cleanKey.includes(':')) {
      cleanKey = Buffer.from(cleanKey).toString('base64');
    } else {
      // It's assumed to be Base64. 
      cleanKey = cleanKey.replace(/-/g, '+').replace(/_/g, '/');
      cleanKey = cleanKey.replace(/[^A-Za-z0-9+/=]/g, "");
      
      if (cleanKey.length % 4 !== 0) {
        cleanKey += '='.repeat(4 - (cleanKey.length % 4));
      }
    }
    
    const authHeader = `Basic ${cleanKey}`;
    
    // Sanitize and validate scope
    let scope = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
    scope = scope.trim().replace(/['"]/g, '');
    
    if (!['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'].includes(scope)) {
        scope = 'GIGACHAT_API_PERS';
    }
    
    console.log(`[GigaChat] Requesting access token. RqUID: ${rquid}, Scope: ${scope}`);
    console.log(`[GigaChat] Auth Header starts with: Basic ${cleanKey.substring(0, 10)}...`);
    
    try {
      const response = await gigaClient.post('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', 
        new URLSearchParams({ scope }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'RqUID': rquid,
            'Authorization': authHeader,
          }
        }
      );

      const data = response.data;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = data.expires_at > 10000000000 ? data.expires_at : data.expires_at * 1000;
      return this.accessToken!;
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorMessage = errorData?.message || error.message;
      console.error(`[GigaChat] Auth failed: ${errorMessage}`, errorData);
      throw new Error(`GigaChat Auth Error: ${errorMessage}`);
    }
  }

  async chat(messages: any[], model: string = 'GigaChat', attachments: string[] = []) {
    const token = await this.getAccessToken();
    
    // According to OpenAPI spec, attachments belong to the message
    const processedMessages = messages.map(m => ({ ...m }));
    if (attachments && attachments.length > 0 && processedMessages.length > 0) {
        const lastUserMessage = [...processedMessages].reverse().find(m => m.role === 'user');
        if (lastUserMessage) {
            lastUserMessage.attachments = attachments;
        }
    }

    const body: any = {
      model,
      messages: processedMessages,
      temperature: 0.7,
    };
    
    try {
      const response = await gigaClient.post('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', 
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          }
        }
      );

      return response.data;
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorMessage = errorData?.message || error.message;
      
      if (error.response?.status === 404) {
          throw new Error(`GigaChat API error: 404 No such model '${model}'`);
      }
      
      console.error(`[GigaChat] Chat failed: ${errorMessage}`, errorData);
      throw new Error(`GigaChat API error: ${error.response?.status || 'Unknown'} ${errorMessage}`);
    }
  }

  async uploadFile(filePath: string, mimeType: string = 'application/pdf') {
    const token = await this.getAccessToken();
    const fileBuffer = await fs.promises.readFile(filePath);
    const filename = path.basename(filePath);
    
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('purpose', 'general');

    try {
      const response = await gigaClient.post('https://gigachat.devices.sberbank.ru/api/v1/files', 
        formData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          }
        }
      );

      return response.data;
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorMessage = errorData?.message || error.message;
      console.error(`[GigaChat] Upload failed: ${errorMessage}`, errorData);
      throw new Error(`GigaChat upload error: ${error.response?.status || 'Unknown'} ${errorMessage}`);
    }
  }

  async analyzePdf(pdfBase64: string, prompt: string) {
    // 1. Save to temp file
    const tempFilePath = path.join(os.tmpdir(), `${uuidv4()}.pdf`);
    await fs.promises.writeFile(tempFilePath, Buffer.from(pdfBase64, 'base64'));

    // Sanitize model name
    let modelName = 'GigaChat';
    if (process.env.GIGACHAT_MODEL && process.env.GIGACHAT_MODEL.trim() !== "") {
        modelName = process.env.GIGACHAT_MODEL.trim().replace(/['"]/g, '');
    }

    try {
      // 2. Upload file
      console.log(`[GigaChat] Uploading file to GigaChat storage (Model: ${modelName})...`);
      const uploadResult = await this.uploadFile(tempFilePath);
      const fileId = uploadResult.id;
      console.log("[GigaChat] File uploaded successfully, ID:", fileId);

      // 3. Chat with file
      const messages = [
        {
          role: 'system',
          content: 'You are a professional academic assistant. You have access to an attached document. Analyze it carefully and provide accurate information based ONLY on the document content. If the document is empty or unreadable, state that clearly.'
        },
        {
          role: 'user',
          content: `${prompt}\n\nPlease use the attached document (ID: ${fileId}) as your primary source.`
        }
      ];

      console.log(`[GigaChat] Sending chat request with attachment using model: ${modelName}...`);
      try {
          return await this.chat(messages, modelName, [fileId]);
      } catch (chatError: any) {
          if (chatError.message.includes("404") && modelName !== 'GigaChat') {
              console.warn(`[GigaChat] Model '${modelName}' not found for native analysis, retrying with default 'GigaChat'...`);
              return await this.chat(messages, 'GigaChat', [fileId]);
          }
          throw chatError;
      }

    } catch (error: any) {
      console.error("[GigaChat] Native file analysis failed or not supported, falling back to text extraction...", error.message);
      
      try {
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const pdfParse = require('pdf-parse');
        const dataBuffer = await fs.promises.readFile(tempFilePath);
        const data = await pdfParse(dataBuffer);
        const text = data.text;

        console.log(`[GigaChat] Extracted ${text.length} characters from PDF using pdf-parse.`);

        if (!text || text.trim().length < 10) {
            console.warn("[GigaChat] Extracted text is too short. The PDF might be scanned or empty.");
            throw new Error("Extracted text is too short or empty. PDF might be an image/scanned document.");
        }

        // Truncate if too long (GigaChat context limit is 128k tokens, so it should be fine for most PDFs)
        const truncatedText = text.slice(0, 100000); // Rough char limit

        const messages = [
          {
            role: 'system',
            content: 'You are a professional academic assistant. Analyze the provided document text carefully. Provide accurate information based ONLY on the text provided below. Do not hallucinate or make up information not present in the text.'
          },
          {
            role: 'user',
            content: `${prompt}\n\n--- DOCUMENT CONTENT START ---\n${truncatedText}\n--- DOCUMENT CONTENT END ---`
          }
        ];

        // For fallback, we use the same modelName. If it fails with 404, we try one last time with 'GigaChat'
        console.log(`[GigaChat] Sending chat request with extracted text using model: ${modelName}...`);
        try {
            return await this.chat(messages, modelName);
        } catch (chatError: any) {
            if (chatError.message.includes("404") && modelName !== 'GigaChat') {
                console.warn(`[GigaChat] Model '${modelName}' not found for fallback, retrying with default 'GigaChat'...`);
                return await this.chat(messages, 'GigaChat');
            }
            throw chatError;
        }
      } catch (fallbackError: any) {
        console.error("[GigaChat] Fallback text extraction also failed:", fallbackError.message);
        throw new Error(`Failed to analyze PDF: ${error.message}. Fallback failed: ${fallbackError.message}`);
      }
    } finally {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  }
}
