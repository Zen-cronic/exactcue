const SESSION_PATTERN = /^demo-[a-z0-9-]{8,58}$/;

declare const sessionBrand: unique symbol;
export type DemoSessionId = string & { readonly [sessionBrand]: true };

export function parseDemoSessionId(value: string | null | undefined): DemoSessionId | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return SESSION_PATTERN.test(normalized) ? (normalized as DemoSessionId) : null;
}

export function createDemoSessionId(): DemoSessionId {
  return `demo-${crypto.randomUUID()}` as DemoSessionId;
}
