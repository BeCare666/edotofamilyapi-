import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';

// Règles métier de la livraison personnalisée (décisions du 24/09/2026) :
// - position obligatoire, description 150 caractères max, téléphone obligatoire ;
// - prix = distance par la route depuis le centre de traitement × prix au km (réglage admin) ;
// - après 5 codes faux (PIN ou OTP), le lien du zem est bloqué jusqu'au déblocage par l'admin.
export const DESCRIPTION_MAX_LENGTH = 150;
export const MAX_FAILED_ATTEMPTS = 5;

export interface CustomDeliveryInput {
  lat: number;
  lng: number;
  description: string;
  phone: string;
}

export function parseCoordinates(lat: any, lng: any): { lat: number; lng: number } {
  const la = Number(lat);
  const ln = Number(lng);
  if (
    lat === null || lat === undefined || lat === '' ||
    lng === null || lng === undefined || lng === '' ||
    !Number.isFinite(la) || !Number.isFinite(ln) ||
    la < -90 || la > 90 || ln < -180 || ln > 180
  ) {
    throw new BadRequestException('Position de livraison invalide.');
  }
  return { lat: la, lng: ln };
}

// Téléphone : chiffres, espaces, tirets, points, parenthèses et un « + » initial ; 8 à 15 chiffres.
export function normalizePhone(phone: any): string {
  if (typeof phone !== 'string') throw new BadRequestException('Numéro de téléphone obligatoire.');
  const trimmed = phone.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) throw new BadRequestException('Numéro de téléphone invalide.');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new BadRequestException('Numéro de téléphone invalide.');
  return (trimmed.startsWith('+') ? '+' : '') + digits;
}

export function parseCustomDelivery(body: any): CustomDeliveryInput {
  const { lat, lng } = parseCoordinates(body?.lat, body?.lng);
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!description) throw new BadRequestException('La description du lieu est obligatoire.');
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    throw new BadRequestException(`La description du lieu est limitée à ${DESCRIPTION_MAX_LENGTH} caractères.`);
  }
  return { lat, lng, description, phone: normalizePhone(body?.phone) };
}

export interface DeliverySettings {
  price_per_km: number | null;
  center_lat: number | null;
  center_lng: number | null;
}

export function isDeliveryConfigured(s: DeliverySettings): boolean {
  return s.price_per_km !== null && s.price_per_km > 0 && s.center_lat !== null && s.center_lng !== null;
}

// Le franc CFA n'a pas de centimes : frais arrondis au franc le plus proche.
export function computeFee(distanceMeters: number, pricePerKm: number) {
  const distance_km = Math.round(distanceMeters / 10) / 100;
  return { distance_km, fee: Math.round((distanceMeters / 1000) * pricePerKm) };
}

export function parseSettingsInput(body: any): DeliverySettings {
  const price = Number(body?.price_per_km);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
    throw new BadRequestException('Prix au kilomètre invalide.');
  }
  const { lat, lng } = parseCoordinates(body?.center_lat, body?.center_lng);
  return { price_per_km: Math.round(price * 100) / 100, center_lat: lat, center_lng: lng };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Lien : 32 octets aléatoires (non devinable). PIN : 6 chiffres, lié au lien dans l'empreinte.
export function generateCourierCredentials() {
  const token = randomBytes(32).toString('base64url');
  const pin = randomInt(100000, 1000000).toString();
  return { token, pin, tokenHash: sha256(token), pinHash: sha256(`${token}:${pin}`) };
}

export function pinMatches(token: string, pin: any, pinHash: string | null): boolean {
  if (!pinHash || typeof pin !== 'string' || !/^\d{6}$/.test(pin.trim())) return false;
  return sha256(`${token}:${pin.trim()}`) === pinHash;
}

// Identifiant d'appareil généré par la page du zem (stocké dans son navigateur).
export function parseDeviceId(deviceId: any): string {
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(deviceId)) {
    throw new BadRequestException('Appareil non reconnu.');
  }
  return deviceId;
}

// wa.me : numéro international sans « + » ni séparateurs.
export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}
