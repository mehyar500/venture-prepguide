#!/usr/bin/env python3
"""PrepGuide mehyar-web patch + push via git-data API (binary-safe).

Usage: python3 pg-mehyarweb-push.py <fresh-worktree-dir> [--dry-run]
The worktree must be checked out at the CURRENT origin/main. Applies ONLY the
PrepGuide changes (exact anchors; aborts loudly on mismatch), commits, and
pushes the 7-file diff onto main via the git-data REST API (PNG blob as
base64 — gh-push.py would corrupt it via utf-8 decode).

MUST be run while holding ~/workspace/.locks/mehyar-web-push.
"""
import base64, json, os, subprocess, sys, urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BASE = "https://api.github.com"
CRED = "custom.github"
UA = "HotZero-Muse/1.0"
OWNER_REPO = "mehyar-us/mehyar-web"
BRANCH = "main"
LOGO_SRC = os.path.expanduser("~/workspace/prepguide/pwa/prepguide-logo.png")
MODULE_SRC = os.path.expanduser("~/workspace/prepguide/mehyar-web/fulfillPrepguide.js")

def api(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method,
        headers={"Accept": "application/vnd.github+json", "User-Agent": UA,
                 "X-GitHub-Api-Version": "2022-11-28"})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    dc.add_surrogate_to_request(req, CRED, allowed_hosts=["api.github.com"])
    try:
        with urllib.request.urlopen(req, data=data, timeout=90) as resp:
            return resp.status, dc.read_json_response(resp)
    except urllib.error.HTTPError as e:
        raw = e.read(4000).decode("utf-8", "replace")
        try: return e.code, json.loads(raw)
        except ValueError: return e.code, {"http_error": e.code, "body": raw}

def sh(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout.strip()

def need_once(text, old, new, what):
    if old not in text:
        raise SystemExit(f"ANCHOR MISS [{what}]: {old[:70]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"ANCHOR NOT UNIQUE [{what}]: count={text.count(old)}")
    return text.replace(old, new, 1)

def patch_file(path, fn):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    new = fn(text)
    if new != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        print("patched:", path)
    else:
        print("unchanged:", path)

def main():
    wt = sys.argv[1]
    dry = "--dry-run" in sys.argv
    R = lambda p: os.path.join(wt, p)

    # ── 1. new fulfillment module (byte-identical to the staged draft) ──
    with open(MODULE_SRC, "rb") as f:
        module_bytes = f.read()
    assert b"fulfillPrepguide" in module_bytes
    with open(R("functions/api/_shared/fulfillPrepguide.js"), "wb") as f:
        f.write(module_bytes)
    print("wrote functions/api/_shared/fulfillPrepguide.js")

    # ── 2. webhook.js: import + hook entry ──
    def p_webhook(t):
        t = need_once(t,
            'import { fulfillBizbuilder } from "../_shared/fulfillBizbuilder.js";',
            'import { fulfillBizbuilder } from "../_shared/fulfillBizbuilder.js";\n'
            'import { fulfillPrepguide } from "../_shared/fulfillPrepguide.js";',
            "webhook import")
        if 'async prepguide(' in t:
            return t
        anchor = ('  async creditfixkit({ db, env, waitUntil }, payment) {\n'
                  '    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);\n'
                  '    await fulfillCreditfixkit({ db, env, waitUntil, sendEmail }, payment);\n'
                  '  },\n')
        entry = ('\n'
                 '  // PrepGuide personalized preparedness playbook ($37 one-time). Creates the\n'
                 '  // prepguide_orders row (idempotent on payment_id via the UNIQUE payment\n'
                 '  // index), reuses the payment access_token as the order token, then hands\n'
                 '  // off to the standalone module for background generation + buyer email.\n'
                 '  async prepguide({ db, env, waitUntil }, payment) {\n'
                 '    const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);\n'
                 '    await fulfillPrepguide({ db, env, waitUntil, sendEmail }, payment);\n'
                 '  },\n')
        return need_once(t, anchor, anchor + entry, "webhook hook")
    patch_file(R("functions/api/pay/webhook.js"), p_webhook)

    # ── 3. Apps.tsx: managedApps entry at the end (after creditfixkit) ──
    def p_apps(t):
        import re
        if 'id: "prepguide"' not in t:
            m = re.search(r'    logo: "/assets/creditfixkit-logo\.png",\n'
                          r'    accentClass: "[^"]+",\n'
                          r'  \},\n', t)
            if not m:
                raise SystemExit("ANCHOR MISS [apps entry]: creditfixkit block")
            entry = ('  {\n'
                     '    id: "prepguide",\n'
                     '    name: "PrepGuide",\n'
                     '    url: "https://prepguide.mehyar.us",\n'
                     '    tagline: "A preparedness plan built around your actual household.",\n'
                     '    description:\n'
                     '      "Answer six questions about your household — adults, kids, pets, home type, region, budget — and get a personalized preparedness playbook: a 72-hour checklist scaled to your people, exact water-storage math, a 30-day food plan, a power-outage playbook, and a prioritized buy list, delivered as a PDF for a one-time $37. Calm, practical, specific — no fear-mongering.",\n'
                     '    audience: "Households who want calm, practical preparedness built around their actual home — not a generic checklist.",\n'
                     '    highlights: [\n'
                     '      "Personalized 72-hour checklist scaled to your household size",\n'
                     '      "Exact water-storage math for your people, home, and region",\n'
                     '      "30-day food plan and power-outage playbook for your budget tier",\n'
                     '      "One-time $37 — free teaser first, PDF download, no account needed",\n'
                     '    ],\n'
                     '    logo: "/assets/prepguide-logo.png",\n'
                     '    accentClass: "from-stone-100 to-white dark:from-stone-900 dark:to-stone-950",\n'
                     '  },\n')
            t = t[:m.end()] + entry + t[m.end():]
        return t
    patch_file(R("client/src/pages/Apps.tsx"), p_apps)

    # ── 4. DataDeletion.tsx: header comment + AppInfo ──
    def p_dd(t):
        import re
        if "prepguide.mehyar.us" not in t.split("Plus any future products")[0]:
            lines = t.split("\n")
            nums = [int(n) for n in re.findall(r"^//\s+(\d+)\.\s", t, re.M)]
            nxt = (max(nums) + 1) if nums else 1
            idx = max(i for i, l in enumerate(lines) if re.match(r"^//\s+\d+\.\s", l))
            lines.insert(idx + 1, f"//  {nxt}. PrepGuide — https://prepguide.mehyar.us (personalized household preparedness playbook)")
            t = "\n".join(lines)
        if 'id: "prepguide"' not in t:
            anchor = "];\n\ninterface Section"
            entry = ('  {\n'
                     '    id: "prepguide",\n'
                     '    name: "PrepGuide",\n'
                     '    url: "https://prepguide.mehyar.us",\n'
                     '    tagline: "Personalized household preparedness playbook.",\n'
                     '    icon: ShieldCheck,\n'
                     '    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",\n'
                     '    whatWeCollect:\n'
                     '      "Email address (to deliver your purchase), the household intake answers you submit (adults, kids, pets, home type, region, budget tier), the generated playbook PDF, and checkout records.",\n'
                     '    whatWeDelete:\n'
                     '      "Email address, household intake answers, generated playbook, and purchase records tied to your email. Deletion via the email fallback within 14 days.",\n'
                     '  },\n'
                     '];\n\ninterface Section')
            t = need_once(t, anchor, entry, "dd appinfo")
        return t
    patch_file(R("client/src/pages/DataDeletion.tsx"), p_dd)

    # ── 5/6. PrivacyPolicy.tsx + Terms.tsx: <li> before Tenant sites ──
    LI = ('          <li className="rounded-xl border border-border bg-card/60 p-3">\n'
          '            <div className="font-semibold">PrepGuide — <a className="text-brand-700 underline dark:text-brand-100" href="https://prepguide.mehyar.us" target="_blank" rel="noreferrer">prepguide.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>\n'
          '            <div className="text-sm text-muted-foreground">Personalized household preparedness playbook — calm, practical, no fear-mongering.</div>\n'
          '          </li>\n')
    def p_policy(t, what):
        if "prepguide.mehyar.us" in t:
            return t
        anchor = ('          <li className="rounded-xl border border-border bg-card/60 p-3">\n'
                  '            <div className="font-semibold">Tenant sites')
        return need_once(t, anchor, LI + anchor, what)
    patch_file(R("client/src/pages/PrivacyPolicy.tsx"), lambda t: p_policy(t, "privacy li"))
    patch_file(R("client/src/pages/Terms.tsx"), lambda t: p_policy(t, "terms li"))

    # ── 7. logo ──
    with open(LOGO_SRC, "rb") as f:
        logo_bytes = f.read()
    assert logo_bytes[:8] == b"\x89PNG\r\n\x1a\n", "logo is not a PNG"
    with open(R("client/public/assets/prepguide-logo.png"), "wb") as f:
        f.write(logo_bytes)
    print("wrote client/public/assets/prepguide-logo.png")

    # ── syntax check the JS ──
    for p in ["functions/api/_shared/fulfillPrepguide.js", "functions/api/pay/webhook.js"]:
        subprocess.run(["node", "--check", R(p)], check=True)
    print("node --check OK")

    # ── commit ──
    files = ["functions/api/_shared/fulfillPrepguide.js", "functions/api/pay/webhook.js",
             "client/src/pages/Apps.tsx", "client/src/pages/DataDeletion.tsx",
             "client/src/pages/PrivacyPolicy.tsx", "client/src/pages/Terms.tsx",
             "client/public/assets/prepguide-logo.png"]
    sh(wt, "add", *files)
    sh(wt, "-c", "user.name=HotZero", "-c", "user.email=hotzero@mehyar.us", "commit", "-m",
       "PrepGuide: webhook fulfill hook + fulfillment module + Products directory entries")
    head = sh(wt, "rev-parse", "HEAD")
    print("committed:", head[:8])

    # ── push via git-data API (binary-safe blobs) ──
    if dry:
        print("DRY RUN: skipping API push")
        return
    st, ref = api(f"/repos/{OWNER_REPO}/git/ref/heads/{BRANCH}")
    assert st == 200, ref
    base_sha = ref["object"]["sha"]
    print("remote base:", base_sha[:8])
    st, base_commit = api(f"/repos/{OWNER_REPO}/commits/{base_sha}")
    assert st == 200, base_commit
    base_tree = base_commit["commit"]["tree"]["sha"]

    tree_items = []
    for path in files:
        with open(R(path), "rb") as f:
            data = f.read()
        if path.endswith(".png"):
            payload = {"content": base64.b64encode(data).decode(), "encoding": "base64"}
        else:
            payload = {"content": data.decode("utf-8"), "encoding": "utf-8"}
        st, blob = api(f"/repos/{OWNER_REPO}/git/blobs", "POST", payload)
        assert st == 201, blob
        tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    st, tree = api(f"/repos/{OWNER_REPO}/git/trees", "POST", {"base_tree": base_tree, "tree": tree_items})
    assert st == 201, tree
    st, commit = api(f"/repos/{OWNER_REPO}/git/commits", "POST",
                     {"message": "PrepGuide: webhook fulfill hook + fulfillment module + Products directory entries",
                      "tree": tree["sha"], "parents": [base_sha]})
    assert st == 201, commit
    new_sha = commit["sha"]
    st, out = api(f"/repos/{OWNER_REPO}/git/refs/heads/{BRANCH}", "PATCH", {"sha": new_sha})
    assert st == 200, out
    print("PUSHED", new_sha)
    print("NEW_SHA=" + new_sha)

main()
