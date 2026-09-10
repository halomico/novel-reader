"""Create synthetic private files only in an ephemeral GitHub Actions checkout."""

import os
import secrets
from pathlib import Path

if os.environ.get("GITHUB_ACTIONS") != "true" or not os.environ.get("GITHUB_ENV"):
    raise SystemExit("Canaries may only be seeded in an ephemeral CI checkout.")

marker = "image-private-canary-" + secrets.token_hex(24)
files = {
    ".env": f"NEXT_PUBLIC_IMAGE_AUDIT_CANARY={marker}\n",
    ".env.production": f"IMAGE_AUDIT_CANARY={marker}\n",
    "data/private.json": marker,
    "library/books/private.txt": marker,
    "backups/private.db": marker,
    "host-private/settings.json": marker,
    "public/uploads/private.json": marker,
    "public/avatars/private.svg": marker,
    "src/.env.private": marker,
    "src/private.key": marker,
    "scripts/ad-hoc-private.ts": marker,
    ".next/standalone/.env": marker,
}
for name in files:
    if Path(name).exists():
        raise SystemExit("Refusing to overwrite an existing canary target.")
for name, content in files.items():
    target = Path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
    output.write(f"IMAGE_AUDIT_CANARY={marker}\n")
print(f"Seeded {len(files)} synthetic private files; values withheld.")
