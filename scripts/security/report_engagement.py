#!/usr/bin/env python3
"""Read aggregate static gameplay event counts; no collector or database is used.

Defaults to the last 24 hours. Counts can be sampled, missed offline/opt-out, or
spoofed; they are neither distinct players nor an authoritative funnel.
"""
import argparse
import datetime
import json
from pathlib import Path
import tomllib
import urllib.request

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--since', default=(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))
p.add_argument('--token-file', type=Path, help='Optional scoped Analytics Read token; defaults to existing Wrangler OAuth login')
args = p.parse_args()
# Validate before using in the GraphQL filter.
datetime.datetime.fromisoformat(args.since.replace('Z', '+00:00'))
if args.token_file:
    token = args.token_file.read_text().strip()
else:
    token = tomllib.loads((Path.home() / '.wrangler/config/default.toml').read_text())['oauth_token']
# The since string is serialized independently rather than interpolating raw input.
q = '''{viewer{zones(filter:{zoneTag:"da0f7a24f83a6dc2d69eb5d8429932c6"}){
httpRequestsAdaptiveGroups(limit:1000,filter:{datetime_geq:%s,clientRequestPath_in:["/play-events/round-started.txt","/play-events/hole-completed.txt","/play-events/round-completed.txt"],edgeResponseStatus:200}){
count dimensions{date clientRequestPath clientRequestHTTPHost}}}}}''' % json.dumps(args.since)
req = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql',
    data=json.dumps({'query': q}).encode(), headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=30) as response:
    data = json.load(response)
if data.get('errors'):
    raise SystemExit(json.dumps(data['errors']))
print(json.dumps({'since': args.since, 'caveat': 'Aggregate signals; not unique or verified humans. Deployment verification requests also appear.', 'data': data['data']}, indent=2))
