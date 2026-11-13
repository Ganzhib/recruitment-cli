export function requestFields(url: string, body: string | null): URLSearchParams {
  const fields = new URL(url).searchParams;
  if (!body) return fields;
  if (body.trimStart().startsWith('{')) {
    try {
      const value: unknown = JSON.parse(body);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, item] of Object.entries(value))
          if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
            fields.set(key, String(item));
      }
    } catch {
      /* An unreadable request cannot establish a matching receipt. */
    }
  } else {
    for (const [key, value] of new URLSearchParams(body)) fields.set(key, value);
  }
  return fields;
}

export function isBossVerification(value: string): boolean {
  const url = new URL(value);
  return url.origin === 'https://www.zhipin.com' && /^\/web\/passport\//.test(url.pathname);
}
