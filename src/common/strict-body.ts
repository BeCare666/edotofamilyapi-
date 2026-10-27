import { ArgumentMetadata, Injectable, Logger, PipeTransform, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage, ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Audit sécurité 2.3 (27/10/2026) : validation stricte des corps de requête, activée DTO par DTO.
 *
 * - Un DTO marqué @StrictDto() passe par ValidationPipe({ whitelist, transform }) : les champs sans
 *   décorateur class-validator sont retirés avant d'arriver au service.
 * - Les NOMS des champs retirés sont journalisés (jamais les valeurs) pour repérer un formulaire qui
 *   enverrait un champ utile non déclaré. Après une période sans alerte : forbidNonWhitelisted.
 * - Les autres DTO gardent le comportement d'avant (validation sans liste blanche).
 */
const STRICT_DTO = Symbol('strictDto');

export function StrictDto(): ClassDecorator {
  return (target) => Reflect.defineMetadata(STRICT_DTO, true, target);
}

export function isStrictDto(metatype: unknown): boolean {
  return typeof metatype === 'function' && Reflect.getOwnMetadata(STRICT_DTO, metatype) === true;
}

/** Champs autorisés d'un DTO : ceux qui portent au moins un décorateur class-validator. */
export function allowedFields(metatype: Function): Set<string> {
  const metas = getMetadataStorage().getTargetValidationMetadatas(metatype, '', true, false);
  return new Set(metas.map((m) => m.propertyName));
}

export function unknownFields(metatype: Function, value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const allowed = allowedFields(metatype);
  return Object.keys(value).filter((k) => !allowed.has(k));
}

/**
 * Valeur simple (texte, nombre, booléen, null) : bloque les objets et tableaux glissés dans un champ
 * attendu comme simple (mysql2 transforme un objet en « clé = valeur » dans une requête).
 */
export function IsScalar(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isScalar',
      validator: {
        validate: (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
        defaultMessage: (args) => `${args?.property} : valeur invalide.`,
      },
    },
    validationOptions,
  );
}

@Injectable()
export class StrictBodyPipe implements PipeTransform {
  private readonly logger = new Logger('ValidationStricte');
  // Comportement d'avant 2.3 (class-validator 0.14 : forbidUnknownValues gardé à false)
  private readonly loose = new ValidationPipe({ forbidUnknownValues: false });
  private readonly strict = new ValidationPipe({ forbidUnknownValues: false, whitelist: true, transform: true });

  async transform(value: any, metadata: ArgumentMetadata) {
    if (metadata.type === 'body' && isStrictDto(metadata.metatype)) {
      const unknown = unknownFields(metadata.metatype as Function, value);
      if (unknown.length) {
        this.logger.warn(`${metadata.metatype.name} : champs inconnus retirés : ${unknown.join(', ')}`);
      }
      return this.strict.transform(value, metadata);
    }
    return this.loose.transform(value, metadata);
  }
}
