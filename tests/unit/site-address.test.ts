import { describe, it, expect } from 'vitest';
import { requestHostFrom, siteAddressMismatch } from '@/lib/seo/site-address';

describe('the host a request was addressed to', () => {
  it('prefers what the proxy forwarded, first entry only', () => {
    expect(requestHostFrom('www.example.com, internal:3000', 'app:3000')).toBe('www.example.com');
    expect(requestHostFrom(null, 'WWW.Example.com')).toBe('www.example.com');
    expect(requestHostFrom('', 'example.com')).toBe('example.com');
    expect(requestHostFrom(null, null)).toBeNull();
  });
});

describe('the site address against where the site is served', () => {
  it('flags a site address left on the bare domain after moving to www', () => {
    expect(siteAddressMismatch('https://example.com', 'www.example.com')).toEqual({
      configured: 'https://example.com',
      actual: 'www.example.com',
      suggested: 'https://www.example.com',
    });
  });

  it('is quiet when they agree, whatever the case or trailing slash', () => {
    expect(siteAddressMismatch('https://www.example.com/', 'www.example.com')).toBeNull();
    expect(siteAddressMismatch('https://WWW.example.com', 'www.example.com')).toBeNull();
    expect(siteAddressMismatch('http://localhost:3000', 'localhost:3000')).toBeNull();
  });

  it('keeps a port that is part of the address', () => {
    expect(siteAddressMismatch('http://example.test:3300', 'www.example.test:3300')?.suggested).toBe(
      'http://www.example.test:3300',
    );
  });

  it('ignores local and internal addresses, which say nothing about the public site', () => {
    expect(siteAddressMismatch('https://www.example.com', 'localhost:3000')).toBeNull();
    expect(siteAddressMismatch('https://www.example.com', '127.0.0.1:3000')).toBeNull();
    expect(siteAddressMismatch('https://www.example.com', '10.0.1.7:3000')).toBeNull();
    expect(siteAddressMismatch('https://www.example.com', null)).toBeNull();
    expect(siteAddressMismatch('not a url', 'www.example.com')).toBeNull();
  });
});
