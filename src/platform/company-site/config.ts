import { z } from 'zod';
import { nameSchema } from '../../core/schemas.js';

const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:', '公司官网必须使用 HTTPS');
export const companySiteSchema = z.strictObject({
  id: nameSchema,
  name: z.string().min(1),
  listingUrl: httpsUrl,
  queryParameter: z.string().min(1).optional(),
  pageParameter: z.string().min(1).optional(),
  allowedOrigins: z
    .array(httpsUrl.refine((value) => new URL(value).origin === value, '必须是纯 origin'))
    .default([]),
  selectors: z.strictObject({
    card: z.string().min(1),
    title: z.string().min(1),
    link: z.string().min(1),
    location: z.string().min(1).optional(),
    description: z.string().min(1),
    next: z.string().min(1).optional(),
  }),
});
export type CompanySiteConfig = z.input<typeof companySiteSchema>;
