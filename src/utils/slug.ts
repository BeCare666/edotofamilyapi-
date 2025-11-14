// src/utils/slug.ts
export function toSlug(text: string): string {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-') // Remplace les espaces par des tirets
        .replace(/[^\w\-]+/g, '') // Supprime les caractères non alphanumériques
        .replace(/\-\-+/g, '-'); // Remplace les tirets multiples par un seul
}
