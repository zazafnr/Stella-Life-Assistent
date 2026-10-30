#!/usr/bin/env python3
"""Baut die statische Website (evolsior.com) aus site-src/ nach site/public/.

    python3 scripts/build-site.py

Cloudflare (Workers mit statischen Dateien) liefert site/public/ aus, Konfiguration: site/wrangler.jsonc. Quellen: site-src/.
Bilder der App liegen in site/assets/stella/ (siehe docs/WEBSITE.md).
"""
import os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC, OUT = os.path.join(ROOT, 'site-src'), os.path.join(ROOT, 'site', 'public')
BASE = 'https://evolsior.com'
MARK = '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><rect x="10" y="5" width="18" height="5" rx="2.5"/><rect x="4" y="13.5" width="18" height="5" rx="2.5"/><rect x="10" y="22" width="18" height="5" rx="2.5"/></svg>'
LINKS = {'__HOME__': '/', '__STELLA__': '/stella', '__IMPRINT__': '/imprint', '__PRIVACY__': '/privacy'}

def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f: return f.read()

def write(path, text):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f: f.write(text)

def fill(body):
    body = body.replace('__MARK__', MARK)
    for k, v in LINKS.items(): body = body.replace(k, v)
    return body

def page(path, title, description, body, og='/assets/og.png', noindex=False):
    url = BASE + (path if path != '/index' else '/')
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#09090B">
<meta name="color-scheme" content="dark">{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:site_name" content="EVOLSIOR">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}{og}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{fill(body)}
</body>
</html>
'''

def main():
    imgs = ':root { --img-chat: url(/assets/stella/chat.jpg); --img-goals: url(/assets/stella/goals.jpg); --img-money: url(/assets/stella/money.jpg); --img-plan: url(/assets/stella/plan.jpg); }'
    write('assets/site.css', '\n'.join([read('common.css'), imgs, read('index.css'), read('stella.css'), read('legal.css')]))
    write('assets/site.js', read('common.js') + '\n' + read('stella.js'))

    write('index.html', page('/index', 'EVOLSIOR – Built to become', 'EVOLSIOR builds calm, precise apps that grow with the people who use them. Home of Stella, a personal assistant for your whole life.', read('index.body.html')))
    write('stella/index.html', page('/stella', 'Stella – Let Stella handle it | EVOLSIOR', 'Stella is a personal assistant for your whole life. Plans, reminders, mail, errands, goals and money, handled in one conversation.', read('stella.body.html')))

    legal = read('legal.body.html')
    head, rest = legal.split('<main id="main">', 1)
    main_, foot = rest.split('</main>', 1)
    wrap_open = main_[:main_.index('<article')]
    def article(i):
        m = re.search(rf'<article id="{i}".*?</article>', main_, re.S)
        return m.group(0)
    for slug, title, desc in [('imprint', 'Imprint | EVOLSIOR', 'Imprint of EVOLSIOR.'), ('privacy', 'Privacy policy | EVOLSIOR', 'How EVOLSIOR and the Stella app handle your data.')]:
        body = f'{head}<main id="main">\n<div class="wrap legal">\n{article(slug)}\n</div>\n</main>{foot}'
        body = body.replace('href="#imprint"', 'href="/imprint"').replace('href="#privacy"', 'href="/privacy"')
        write(f'{slug}/index.html', page(f'/{slug}', title, desc, body))

    write('404.html', page('/404', 'Page not found | EVOLSIOR', 'This page does not exist.', '''<header class="nav"><div class="wrap"><a class="brand" href="/" aria-label="EVOLSIOR home">__MARK__EVOLSIOR</a></div></header>
<main id="main"><section class="hero"><div class="wrap"><p class="label" style="margin-bottom:28px">Error 404</p><h1>Nothing<br>here.</h1><p class="lead">This page does not exist, or it has moved.</p><div class="actions"><a class="btn" href="/">Back to start <span class="arrow">→</span></a></div></div></section></main>''', noindex=True))

    write('robots.txt', f'User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')
    write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{BASE}{p}</loc></url>\n' for p in ['/', '/stella', '/imprint', '/privacy']) + '</urlset>\n')
    write('_redirects', '/impressum /imprint 301\n/datenschutz /privacy 301\n/stella/app https://stella.evolsior.com 302\n')
    write('_headers', '''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
''')
    write('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#09090B"/><g fill="#fff"><rect x="10" y="6" width="16" height="4.4" rx="2.2"/><rect x="6" y="13.8" width="16" height="4.4" rx="2.2"/><rect x="10" y="21.6" width="16" height="4.4" rx="2.2"/></g></svg>\n')
    print('site/public/ gebaut')

main()
