import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.AES_SECRET_KEY || 'mirai_hub_secure_32_byte_secret_key'; 
const IV_LENGTH = 16; 

export class CryptoUtils {
  /**
   * 1. ENCRYPT STRING PAYLOADS
   */
  static encrypt(text: string): string {
    if (!text) return '';

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * 2. DECRYPT STRING PAYLOADS
   */
  static decrypt(encryptedText: string): string {
    if (!encryptedText || !encryptedText.includes(':')) return '';

    try {
      const textParts = encryptedText.split(':');
      const ivHex = textParts.shift()!;
      const encryptedDataHex = textParts.join(':'); // 🌟 Keep this as a plain hex string
      
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
      
      // 🌟 Passing a string with 'hex' input and 'utf8' output matches the compiler overload perfectly!
      let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Cryptographic decryption pipeline crash:', error);
      throw new Error('Failed to resolve secure data payload blocks.');
    }
  }
}
