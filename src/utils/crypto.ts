import * as bip39 from 'bip39';

export async function generateEncryptionKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(exported);
}

export async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64Key);
  return await crypto.subtle.importKey(
    'raw',
    buffer,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export function generateMnemonic(): string {
  return bip39.generateMnemonic(128); // 12 words
}

export async function mnemonicToKey(mnemonic: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const rawKey = seed.slice(0, 32);
  return arrayBufferToBase64(rawKey.buffer);
}

export async function derivePasswordKey(password: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function wrapKey(keyToWrapBase64: string, wrappingKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKeyData = base64ToArrayBuffer(keyToWrapBase64);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    rawKeyData
  );
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return arrayBufferToBase64(result.buffer);
}

export async function unwrapKey(wrappedKeyBase64: string, unwrappingKey: CryptoKey): Promise<string> {
  const data = new Uint8Array(base64ToArrayBuffer(wrappedKeyBase64));
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    unwrappingKey,
    encrypted
  );
  return arrayBufferToBase64(decrypted);
}

export async function encryptFile(file: File, base64Key: string): Promise<Blob> {
  const key = await importEncryptionKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const arrayBuffer = await file.arrayBuffer();
  
  const encryptedContent = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    arrayBuffer
  );
  
  return new Blob([iv, encryptedContent], { type: 'application/octet-stream' });
}

export async function decryptFile(blob: Blob, base64Key: string, mimeType: string = 'image/jpeg'): Promise<Blob> {
  const key = await importEncryptionKey(base64Key);
  const arrayBuffer = await blob.arrayBuffer();
  
  const iv = arrayBuffer.slice(0, 12);
  const encryptedContent = arrayBuffer.slice(12);
  
  const decryptedContent = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    encryptedContent
  );
  
  return new Blob([decryptedContent], { type: mimeType });
}
