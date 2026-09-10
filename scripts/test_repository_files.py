import json
import subprocess
import tempfile
import unittest
from pathlib import Path

CHECK = Path(__file__).with_name("check-repository-files.mjs").resolve()
RULES = Path(__file__).resolve().parents[1].joinpath(".gitignore").read_bytes()


class RepositoryFilesTest(unittest.TestCase):
    def test_normal_git_add_accepts_nested_code_and_ignores_local_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "--quiet", directory], check=True)
            root.joinpath(".gitignore").write_bytes(RULES)
            allowed = ["src/nested/deep/module.ts", "src/nested/module.test.ts", "public/avatar-widgets/eyes/a.svg",
                       "migrations/postgres/0001_test.sql", "scripts/check-repository-files.mjs",
                       "scripts/sanitize-standalone.mjs"]
            private = ["src/nested/.env.local", "src/nested/private.pem", "data/users.json",
                       "docs/design.md", "scripts/manual-local-runner.ts", "public/avatars/user.svg"]
            for name in allowed + private:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic", encoding="utf-8")
            subprocess.run(["git", "add", "--all"], cwd=root, check=True)
            tracked = subprocess.run(["git", "ls-files"], cwd=root, check=True,
                                     capture_output=True, text=True).stdout.splitlines()
            self.assertTrue(set(allowed).issubset(tracked))
            self.assertTrue(set(private).isdisjoint(tracked))

    def test_force_added_private_files_are_detected_without_reading_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "--quiet", directory], check=True)
            root.joinpath(".gitignore").write_bytes(RULES)
            allowed = ["src/app/page.tsx", "src/lib/example.test.ts", "migrations/postgres/0001_test.sql",
                       "scripts/test-postgres-integration.ts", "scripts/audit-container-image.py",
                       "public/default-avatars/a.svg", "public/avatar-widgets/eyes/a.svg", "package-lock.json"]
            private = [".env", "ARCHITECTURE_REVIEW_2026-09-06.md", "POSTGRESQL_UPGRADE_PLAN_2026-09-06.md",
                       "AGENTS.md", "data/users.json", "public/avatars/local.svg", "src/config.key",
                       "src/.env.local", "src/private.sqlite3", "scripts/mega-e2e-runner.ts",
                       "docs/report.md", "host-private/config.json", "scripts/test-fixture.json"]
            for name in allowed + private:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic local value", encoding="utf-8")
            subprocess.run(["git", "add", "--force", "--all"], cwd=root, check=True)
            result = subprocess.run(["node", str(CHECK)], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            findings = [json.loads(line).split(": ")[0] for line in result.stderr.splitlines() if line.startswith('"')]
            self.assertEqual(set(findings), set(private))

    def test_push_rejects_private_file_deleted_in_a_later_unpublished_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
            git("init", "--quiet")
            git("config", "user.name", "Scope Test")
            git("config", "user.email", "test@example.invalid")
            root.joinpath(".gitignore").write_bytes(RULES)
            git("add", ".gitignore")
            git("commit", "--quiet", "-m", "safe base")
            remote = git("rev-parse", "HEAD")
            root.joinpath("private-plan.md").write_text("synthetic private value")
            git("add", "--force", "private-plan.md")
            git("commit", "--quiet", "-m", "private earlier tree")
            git("rm", "private-plan.md")
            git("commit", "--quiet", "-m", "delete later")
            local = git("rev-parse", "HEAD")
            result = subprocess.run(["node", str(CHECK), "--pre-push", "origin"], cwd=root,
                input=f"refs/heads/main {local} refs/heads/main {remote}\n", capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("private-plan.md", result.stderr)
            self.assertNotIn("synthetic private value", result.stderr)

    def test_push_does_not_reject_unchanged_legacy_paths_or_path_deletions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
            git("init", "--quiet")
            git("config", "user.name", "Scope Test")
            git("config", "user.email", "test@example.invalid")
            root.joinpath(".gitignore").write_bytes(RULES)
            root.joinpath("legacy-plan.md").write_text("already remote")
            root.joinpath("src").mkdir()
            root.joinpath("src/app.ts").write_text("export const version = 1")
            git("add", "--force", "--all")
            git("commit", "--quiet", "-m", "remote base")
            remote = git("rev-parse", "HEAD")
            root.joinpath("src/app.ts").write_text("export const version = 2")
            git("add", "src/app.ts")
            git("commit", "--quiet", "-m", "code only")
            root.joinpath("legacy-plan.md").unlink()
            git("add", "--update")
            git("commit", "--quiet", "-m", "remove legacy file")
            local = git("rev-parse", "HEAD")
            result = subprocess.run(["node", str(CHECK), "--pre-push", "origin"], cwd=root,
                input=f"refs/heads/main {local} refs/heads/main {remote}\n", capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
