import { BadRequestException } from '@nestjs/common';
import { ATTACHMENT_MAX_BYTES, UploadsController, isAcceptedAttachment } from './uploads.controller';
import { parseRawUrl, signedInvoiceUrl } from '../payment-intent/invoice-storage';

// Audit sécurité 2.8 (29/10/2026) : fichiers envoyés contrôlés, factures en accès restreint
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n...');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const file = (mimetype: string, buffer: Buffer, originalname = 'f'): any => ({ mimetype, buffer, originalname, size: buffer.length });

describe('/attachments : type réel, taille', () => {
  it('accepte JPEG, PNG, WebP et PDF dont les premiers octets correspondent', () => {
    expect(isAcceptedAttachment(file('image/png', PNG))).toBe(true);
    expect(isAcceptedAttachment(file('image/jpeg', JPEG))).toBe(true);
    expect(isAcceptedAttachment(file('application/pdf', PDF))).toBe(true);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    expect(isAcceptedAttachment(file('image/webp', webp))).toBe(true);
  });

  it('refuse un fichier déguisé (HTML annoncé en image ou en PDF) et les autres types', () => {
    expect(isAcceptedAttachment(file('image/png', HTML))).toBe(false);
    expect(isAcceptedAttachment(file('application/pdf', HTML))).toBe(false);
    expect(isAcceptedAttachment(file('image/svg+xml', Buffer.from('<svg/>')))).toBe(false);
    expect(isAcceptedAttachment(file('application/zip', Buffer.from('PK\x03\x04')))).toBe(false);
  });

  it('5 Mo au plus par fichier, gardé en mémoire pour le contrôle (pas d’envoi direct vers Cloudinary)', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('un seul fichier refusé : rien n’est envoyé', async () => {
    const uploader = jest.fn();
    UploadsController.uploader = uploader;
    await expect(new UploadsController().uploadFile([file('image/png', PNG), file('image/png', HTML)])).rejects.toBeInstanceOf(BadRequestException);
    expect(uploader).not.toHaveBeenCalled();
  });

  it('fichiers valides : envoyés, réponse inchangée pour l’admin (url, key, mimeType…)', async () => {
    UploadsController.uploader = jest.fn(async () => ({ url: 'https://res.cloudinary.com/x/image/upload/v1/uploads/a.png', key: 'uploads/a', size: 12 }));
    const out = await new UploadsController().uploadFile([file('image/png', PNG, 'logo.png')]);
    expect(out).toEqual([
      { originalName: 'logo.png', filename: 'uploads/a', size: 12, mimeType: 'image/png', url: 'https://res.cloudinary.com/x/image/upload/v1/uploads/a.png', key: 'uploads/a' },
    ]);
  });
});

describe('Factures : lien signé de courte durée', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = '123';
    process.env.CLOUDINARY_API_SECRET = 'secret';
  });
  afterAll(() => {
    process.env = env;
  });

  it('lit le mode de stockage et l’identifiant d’une adresse Cloudinary', () => {
    expect(parseRawUrl('https://res.cloudinary.com/demo/raw/upload/v1730000000/invoice_client_ORD-1')).toEqual({ type: 'upload', publicId: 'invoice_client_ORD-1' });
    expect(parseRawUrl('https://res.cloudinary.com/demo/raw/authenticated/s--abc--/v1/invoice_client_ORD-1')).toEqual({ type: 'authenticated', publicId: 'invoice_client_ORD-1' });
    expect(parseRawUrl('/invoices/x.pdf')).toBeNull();
  });

  it('facture restreinte : lien de téléchargement signé qui expire après 5 min, jamais l’adresse du fichier', () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0);
    const link = signedInvoiceUrl('https://res.cloudinary.com/demo/raw/authenticated/s--abc--/v1/invoice_client_ORD-1', now);
    expect(link.url).toContain('https://api.cloudinary.com/v1_1/demo/raw/download?');
    expect(link.url).toContain('signature=');
    expect(link.url).toContain(`expires_at=${now / 1000 + 300}`);
    expect(link.url).toContain('type=authenticated');
    expect(link.url).not.toContain('secret');
    expect(link.expires_at).toBe('2026-10-29T12:05:00.000Z');
  });

  it('ancienne facture encore publique (avant invoices:protect) : rendue telle quelle', () => {
    const url = 'https://res.cloudinary.com/demo/raw/upload/v1/invoice_client_ORD-1';
    expect(signedInvoiceUrl(url)).toEqual({ url, expires_at: null });
  });
});
