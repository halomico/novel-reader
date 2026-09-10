import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("image_audit", Path(__file__).with_name("audit-container-image.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, value in files.items():
            item = tarfile.TarInfo(name)
            if isinstance(value, tuple):
                item.type, item.linkname = value
                archive.addfile(item)
            else:
                item.size = len(value)
                archive.addfile(item, io.BytesIO(value))
    return output.getvalue()


class ImageAuditTest(unittest.TestCase):
    def check_image(self, layers, *, config=None, **options):
        layers = {f"layer-{i}.tar": tar_bytes(files) for i, files in enumerate(layers)}
        config = config or {"config": {"User": "nextjs", "Env": ["NODE_ENV=production"]}}
        content = tar_bytes({
            "manifest.json": json.dumps([{"Config": "config.json", "Layers": list(layers)}]).encode(),
            "config.json": json.dumps(config).encode(), **layers,
        })
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "image.tar"
            archive.write_bytes(content)
            return audit.audit_image(archive, **options)

    def test_minimal_safe_runtime(self):
        self.assertEqual(self.check_image([{
            "app/server.js": b"server", "app/public/default-avatars/a.svg": b"svg",
            "app/maintenance/init-postgres.js": b"postgres", "usr/bin/node": b"node:sqlite",
        }], require_postgres=True), [])

    def test_secret_in_deleted_earlier_layer_is_rejected(self):
        issues = self.check_image([{"app/.env": b"not printed"}, {"app/.wh..env": b""}])
        self.assertTrue(any("app/.env" in issue for issue in issues))
        self.assertFalse(any("not printed" in issue for issue in issues))

    def test_public_uploads_and_host_files_are_rejected(self):
        for name in ["app/public/avatars/user.svg", "app/public/settings.json", "app/data/users.json",
                     "app/src/local.ts", "app/private.key", "app/maintenance/ad-hoc.js",
                     "app/node_modules/example/.env.production", "app/library/books/novel.txt",
                     "app/settings.json", "app/host-private/config.json", "app/migrations/private.json"]:
            with self.subTest(name=name):
                self.assertTrue(self.check_image([{name: b"private"}]))

    def test_canary_embedded_in_bundle_is_rejected(self):
        marker = "synthetic-private-canary-12345678"
        issues = self.check_image([{"app/.next/server/chunks/a.js": b"x" * (1024 * 1024 - 5) + marker.encode()}], canary=marker)
        self.assertTrue(any("canary" in issue for issue in issues))
        self.assertFalse(any(marker in issue for issue in issues))

    def test_metadata_and_history_secrets_are_rejected_without_values(self):
        issues = self.check_image([{"app/server.js": b"ok"}], config={
            "config": {"User": "nextjs", "Env": ["DATABASE_URL=private-credential"]},
            "history": [{"created_by": "RUN |1 SMTP_PASSWORD=private-credential"}],
        })
        self.assertEqual(len(issues), 2)
        self.assertFalse(any("private-credential" in issue for issue in issues))

    def test_non_root_required(self):
        for user in ["", "0", "root", "0:1001"]:
            self.assertTrue(self.check_image([{"app/server.js": b"ok"}], config={"config": {"User": user}}))

    def test_postgres_gate_detects_legacy_compiled_code(self):
        files = {"app/.next/server/chunks/a.js": b'require("node:sqlite")'}
        self.assertEqual(self.check_image([files]), [])
        self.assertTrue(self.check_image([files], require_postgres=True))
        self.assertTrue(self.check_image([{"app/server.js": b"ok"}], require_postgres=True, config={
            "config": {"User": "nextjs", "Env": ["DATABASE_PATH=/app/data/novels.db"]},
        }))

    def test_links_cannot_hide_private_files_or_escape_app(self):
        for target in ["../.env", "/run/secrets/password", "../../../etc/passwd"]:
            self.assertTrue(self.check_image([{"app/modules/innocent": (tarfile.SYMTYPE, target)}]))
        self.assertEqual(self.check_image([{"app/node_modules/link": (tarfile.SYMTYPE, "./package/index.js")}]), [])

    def test_malformed_or_traversing_layer_fails_closed(self):
        with self.assertRaises(ValueError):
            self.check_image([{"app/../outside": b"secret"}])

    def test_local_standalone_rejects_next_copied_dotenv(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, ".env").write_text("private")
            self.assertTrue(audit.audit_directory(directory))


if __name__ == "__main__":
    unittest.main()
