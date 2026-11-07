#!/usr/bin/env python3
"""Apply only the reviewed ThreeWood scanner and AI-crawler restrictions.

Read a scoped token from a private file; never log it. Existing WAF rules are
preserved. Before/after settings are written outside the repository for rollback.
"""
import argparse
import json
from pathlib import Path
import urllib.request
import urllib.error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--apply', action='store_true', help='Without this flag, inspect and print the intended change only')
    args = parser.parse_args()
    plan = json.loads(Path(__file__).with_name('cloudflare-restrictions.json').read_text())
    token = args.token_file.read_text().strip()
    base = f'https://api.cloudflare.com/client/v4/zones/{plan["zone_id"]}'

    def call(path, method='GET', data=None):
        request = urllib.request.Request(base + path, method=method,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
            data=json.dumps(data).encode() if data is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            # API response body contains no request headers or credentials.
            raise RuntimeError(f'Cloudflare {method} {path}: HTTP {error.code}: {error.read().decode()}') from None
        if not result.get('success'):
            raise RuntimeError(f'Cloudflare rejected {path}: {result.get("errors")}')
        return result.get('result')

    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    def record(name, result):
        (args.evidence_dir / (name + '.json')).write_text(json.dumps(result, indent=2))

    bots = call('/bot_management')
    record('bots-before', bots)
    path = '/rulesets/phases/http_request_firewall_custom/entrypoint'
    try:
        ruleset = call(path)
    except RuntimeError as error:
        if 'HTTP 404' not in str(error):
            raise
        ruleset = None
    record('waf-before', ruleset)
    rule = plan['scanner_rule']
    print(json.dumps({'zone': plan['zone'], 'rule': rule, 'bot_update': plan['bot_management_update'], 'apply': args.apply}, indent=2))
    if not args.apply:
        return

    if ruleset:
        existing = next((r for r in ruleset.get('rules', []) if r.get('ref') == rule['ref']), None)
        if existing:
            call(f'/rulesets/{ruleset["id"]}/rules/{existing["id"]}', 'PATCH', rule)
        else:
            call(f'/rulesets/{ruleset["id"]}/rules', 'POST', rule)
    else:
        call('/rulesets', 'POST', {'name': 'ThreeWood scanner protection', 'kind': 'zone',
             'phase': 'http_request_firewall_custom', 'rules': [rule]})
    call('/bot_management', 'PUT', plan['bot_management_update'])
    after_rules = call(path)
    after_bots = call('/bot_management')
    record('waf-after', after_rules)
    record('bots-after', after_bots)
    applied = next((r for r in after_rules.get('rules', []) if r.get('ref') == rule['ref']), None)
    assert applied and all(applied.get(k) == rule[k] for k in ('action', 'enabled', 'expression')), 'WAF readback mismatch'
    assert after_bots.get('ai_bots_protection') == 'block', 'AI-crawler setting readback mismatch'
    old_rules = {r['id']: r for r in (ruleset or {}).get('rules', []) if r.get('ref') != rule['ref']}
    new_rules = {r['id']: r for r in after_rules.get('rules', [])}
    for rid, old in old_rules.items():
        assert rid in new_rules and all(new_rules[rid].get(k) == old.get(k) for k in ('action', 'enabled', 'expression')), 'Unrelated rule changed'
    assert after_bots.get('fight_mode') == bots.get('fight_mode'), 'Broad Bot Fight Mode unexpectedly changed'
    print('Verified: scanner rule and AI-crawler blocking enabled; existing rules preserved.')


if __name__ == '__main__':
    main()
