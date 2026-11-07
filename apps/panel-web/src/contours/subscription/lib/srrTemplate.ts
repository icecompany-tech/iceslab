import { templateTypeForFormat, type SubscriptionFormat, type TemplateType } from '@iceslab/shared';

/**
 * The choices of the rule's template field (A-236 step 4).
 *
 *   null              the Default of the type, always offered;
 *   names             the operator's templates of the type the format is
 *                     framed by (a template marked Default is the Default);
 *   the current name  kept even when the format takes no template or the type
 *                     has no such name: the server refuses it at this field,
 *                     and the operator sees what is stored instead of it
 *                     vanishing from the picker.
 * `takesTemplate` false: the format frames no template, said beside the field.
 * The type by format is the contract's `templateTypeForFormat` (shared, A-249),
 * the one the server refuses by, not a copy.
 */
export function srrTemplateChoices(
  format: SubscriptionFormat,
  templates: readonly { type: TemplateType; name: string; isDefault: boolean }[],
  current: string | null,
): { takesTemplate: boolean; names: string[] } {
  const type = templateTypeForFormat(format);
  const names = type ? templates.filter((t) => t.type === type && !t.isDefault).map((t) => t.name) : [];
  if (current !== null && !names.includes(current)) names.push(current);
  return { takesTemplate: type !== null, names };
}

/**
 * The template key of the save: on a new rule only a chosen template, on an
 * edit only a change (`null` = back to the Default). A server older than step
 * 4 (`stored` undefined) gets no key at all.
 */
export function srrTemplatePatch(
  stored: string | null | undefined,
  chosen: string | null,
  isNew: boolean,
): { templateName?: string | null } {
  if (isNew) return chosen === null ? {} : { templateName: chosen };
  if (stored === undefined || stored === chosen) return {};
  return { templateName: chosen };
}
