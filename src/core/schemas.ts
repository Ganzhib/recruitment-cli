import { z } from 'zod';

export const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const roleSchema = z.enum(['seeker', 'recruiter']);
export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: roleSchema,
});
export const identitySchema = z.object({
  platformId: nameSchema,
  accountId: z.string().min(1),
  bindingId: z.string().regex(/^[a-f0-9]{32}$/),
});
export const activitySchema = z.object({
  label: z.string(),
  withinMinutes: z.number().nonnegative().nullable(),
});
export const targetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['job', 'candidate']),
  title: z.string(),
  name: z.string(),
  organization: z.string(),
  location: z.string(),
  summary: z.string(),
  url: z.url(),
  activity: activitySchema,
  contactState: z.enum(['available', 'contacted', 'unavailable']),
  context: z.record(z.string(), z.unknown()),
});
export const searchInputSchema = z.object({
  query: z.string().trim().min(1),
  city: z.string().trim().optional(),
  page: z.number().int().positive().default(1),
  options: z.record(z.string(), z.unknown()).default({}),
});
export const searchPageSchema = z.object({ targets: z.array(targetSchema), hasMore: z.boolean() });
export const detailInputSchema = z.object({ target: targetSchema });
export const detailSchema = z.object({ target: targetSchema, description: z.string() });
export const contactInputSchema = z.object({ target: targetSchema });
export const preparedContactSchema = z.object({
  target: targetSchema,
  ready: z.boolean(),
  reason: z.string().optional(),
});
export const receiptSchema = z.object({
  state: z.enum(['sent', 'already-contacted', 'unavailable']),
  evidence: z.object({ source: z.string(), message: z.string() }),
});
export const positionsSchema = z.array(
  z.object({ id: z.string(), title: z.string(), location: z.string(), salary: z.string() }),
);
export const selectionSchema = z.object({
  query: z.string().trim().min(1),
  city: z.string().trim().optional(),
  activeWithin: z
    .string()
    .regex(/^(any|online|[1-9]\d*[mhd])$/)
    .default('7d'),
  limit: z.number().int().min(1).max(200).default(10),
  maxPages: z.number().int().min(1).max(50).default(3),
  options: z.record(z.string(), z.unknown()).default({}),
});

export type Role = z.infer<typeof roleSchema>;
export type AccountProfile = z.infer<typeof profileSchema>;
export type AccountIdentity = z.infer<typeof identitySchema>;
export type Target = z.infer<typeof targetSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchPage = z.infer<typeof searchPageSchema>;
export type TargetDetail = z.infer<typeof detailSchema>;
export type PreparedContact = z.infer<typeof preparedContactSchema>;
export type ContactReceipt = z.infer<typeof receiptSchema>;
export type Selection = z.infer<typeof selectionSchema>;
export type SelectionInput = z.input<typeof selectionSchema>;

export const capabilitySchemas = {
  'position.list': { input: z.object({}), output: positionsSchema },
  'opportunity.search': { input: searchInputSchema, output: searchPageSchema },
  'opportunity.detail': { input: detailInputSchema, output: detailSchema },
  'contact.prepare': { input: contactInputSchema, output: preparedContactSchema },
  'contact.send': { input: contactInputSchema, output: receiptSchema },
} as const;
export type CapabilityId = keyof typeof capabilitySchemas;
export type CapabilityInput<K extends CapabilityId> = z.input<
  (typeof capabilitySchemas)[K]['input']
>;
export type CapabilityPayload<K extends CapabilityId> = z.output<
  (typeof capabilitySchemas)[K]['input']
>;
export type CapabilityOutput<K extends CapabilityId> = z.output<
  (typeof capabilitySchemas)[K]['output']
>;
