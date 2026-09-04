import { describe, it, expect } from 'vitest';
import { targetMatchesTyped } from '../src/lib/targetMatcher.js';

describe('targetMatchesTyped — DOMAIN', () => {
  it('matches the exact domain and true subdomains, case-insensitively', () => {
    expect(targetMatchesTyped('DOMAIN', 'Example.com', 'example.com')).toBe(true);
    expect(targetMatchesTyped('DOMAIN', 'example.com', 'api.example.com')).toBe(true);
  });

  it('does NOT match a lookalike domain with no real subdomain relationship (the old string-suffix bug)', () => {
    expect(targetMatchesTyped('DOMAIN', 'example.com', 'evilexample.com')).toBe(false);
    expect(targetMatchesTyped('DOMAIN', 'example.com', 'notexample.com')).toBe(false);
  });
});

describe('targetMatchesTyped — SUBDOMAIN', () => {
  it('matches only the exact host, not further sub-subdomains', () => {
    expect(targetMatchesTyped('SUBDOMAIN', 'api.example.com', 'api.example.com')).toBe(true);
    expect(targetMatchesTyped('SUBDOMAIN', 'api.example.com', 'v2.api.example.com')).toBe(false);
  });
});

describe('targetMatchesTyped — IP', () => {
  it('matches only the exact address', () => {
    expect(targetMatchesTyped('IP', '10.0.0.5', '10.0.0.5')).toBe(true);
    expect(targetMatchesTyped('IP', '10.0.0.5', '10.0.0.6')).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    expect(targetMatchesTyped('IP', '10.0.0.5', 'not-an-ip')).toBe(false);
    expect(targetMatchesTyped('IP', 'not-an-ip', '10.0.0.5')).toBe(false);
  });
});

describe('targetMatchesTyped — CIDR (the real fix: was previously unmatchable by any IP at all)', () => {
  it('authorizes an individual IP inside the range', () => {
    expect(targetMatchesTyped('CIDR', '10.0.0.0/24', '10.0.0.42')).toBe(true);
    expect(targetMatchesTyped('CIDR', '10.0.0.0/24', '10.0.1.1')).toBe(false);
  });

  it('handles a /32 as a single-host range and /0 as everything', () => {
    expect(targetMatchesTyped('CIDR', '10.0.0.5/32', '10.0.0.5')).toBe(true);
    expect(targetMatchesTyped('CIDR', '10.0.0.5/32', '10.0.0.6')).toBe(false);
    expect(targetMatchesTyped('CIDR', '0.0.0.0/0', '203.0.113.7')).toBe(true);
  });

  it('never matches a bare hostname against a CIDR scope', () => {
    expect(targetMatchesTyped('CIDR', '10.0.0.0/24', 'example.com')).toBe(false);
  });

  it('rejects a malformed CIDR rather than throwing', () => {
    expect(targetMatchesTyped('CIDR', 'not-a-cidr', '10.0.0.5')).toBe(false);
    expect(targetMatchesTyped('CIDR', '10.0.0.0/99', '10.0.0.5')).toBe(false);
  });
});

describe('targetMatchesTyped — URL', () => {
  it('matches the same origin, and a path scope covers only that path prefix', () => {
    expect(targetMatchesTyped('URL', 'https://example.com/api', 'https://example.com/api/v1/users')).toBe(true);
    expect(targetMatchesTyped('URL', 'https://example.com/api', 'https://example.com/admin')).toBe(false);
  });

  it('does not cross origins (scheme, host, or port)', () => {
    expect(targetMatchesTyped('URL', 'https://example.com', 'http://example.com')).toBe(false);
    expect(targetMatchesTyped('URL', 'https://example.com', 'https://example.com:8443')).toBe(false);
    expect(targetMatchesTyped('URL', 'https://example.com', 'https://evil.com')).toBe(false);
  });
});

describe('targetMatchesTyped — REPOSITORY', () => {
  it('treats https and git@ forms of the same repo, with or without .git, as identical', () => {
    expect(targetMatchesTyped('REPOSITORY', 'https://github.com/org/repo.git', 'github.com/org/repo')).toBe(true);
    expect(targetMatchesTyped('REPOSITORY', 'git@github.com:org/repo.git', 'github.com/org/repo')).toBe(true);
  });

  it('does not match a different repository', () => {
    expect(targetMatchesTyped('REPOSITORY', 'github.com/org/repo', 'github.com/org/other-repo')).toBe(false);
  });
});

describe('targetMatchesTyped — CONTAINER', () => {
  it('matches any tag/digest of the same image', () => {
    expect(targetMatchesTyped('CONTAINER', 'registry.example.com/app', 'registry.example.com/app:v1.2.3')).toBe(true);
    expect(targetMatchesTyped('CONTAINER', 'registry.example.com/app', 'registry.example.com/app@sha256:abcd')).toBe(true);
  });

  it('does not match a different image', () => {
    expect(targetMatchesTyped('CONTAINER', 'registry.example.com/app', 'registry.example.com/other:v1')).toBe(false);
  });
});

describe('targetMatchesTyped — CLOUD_ACCOUNT and KUBERNETES_CLUSTER', () => {
  it('require exact identifier match', () => {
    expect(targetMatchesTyped('CLOUD_ACCOUNT', '123456789012', '123456789012')).toBe(true);
    expect(targetMatchesTyped('CLOUD_ACCOUNT', '123456789012', '999999999999')).toBe(false);
    expect(targetMatchesTyped('KUBERNETES_CLUSTER', 'prod-cluster', 'prod-cluster')).toBe(true);
    expect(targetMatchesTyped('KUBERNETES_CLUSTER', 'prod-cluster', 'staging-cluster')).toBe(false);
  });
});

describe('targetMatchesTyped — fail closed on unrecognized types', () => {
  it('returns false rather than throwing for an unknown target_type', () => {
    expect(targetMatchesTyped('SOMETHING_MADE_UP', 'x', 'x')).toBe(false);
  });
});
