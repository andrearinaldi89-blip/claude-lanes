"""Tests of the guard, the delivery gate and the config reader: a fake project in a
temporary folder, and the hooks launched the way Claude Code launches them, with the
call on stdin.

    python3 -m unittest discover -s tests -p '*_test.py'
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks")
GUARD = os.path.join(HOOKS, "guard.py")
DELIVERY = os.path.join(HOOKS, "delivery.py")
sys.path.insert(0, HOOKS)
from config import normalize, doc_paths  # noqa: E402

ENGLISH = {
    "name": "Acme", "prefix": "acme", "clones": "lanes",
    "lanes": [{"id": "dev", "name": "Development", "branches": ["dev/"]}],
    "bench": "~/.cache/acme-review", "lock": "~/.cache/acme-e2e.lock",
    "protected": {"volumes": ["acme_pgdata"], "stacks": ["acme"], "folders": ["db/migrations/"]},
    "release": [r"gcloud\s+run\s+deploy\b", r"\S*deploy\.sh\b"],
}
ITALIAN = {
    "nome": "Acme", "prefisso": "acme", "cloni": "lanes",
    "binari": [{"id": "dev", "nome": "Sviluppo", "rami": ["dev/"]}],
    "banco": "~/.cache/acme-review", "lucchetto": "~/.cache/acme-e2e.lock",
    "protetti": {"volumi": ["acme_pgdata"], "stack": ["acme"], "cartelle": ["db/migrations/"]},
    "rilascio": [r"gcloud\s+run\s+deploy\b", r"\S*deploy\.sh\b"],
}


def sh(cwd, *argv):
    subprocess.run(argv, cwd=cwd, check=True, capture_output=True)


def make_project(tmp, name, config):
    """A main folder with a protected migration committed on main, and a lane clone on dev/cp1."""
    main = os.path.join(tmp, name)
    os.makedirs(os.path.join(main, ".claude"))
    os.makedirs(os.path.join(main, "db", "migrations"))
    config = dict(config)
    config["root" if "name" in config else "cartella"] = main
    with open(os.path.join(main, ".claude", "metodo.json"), "w") as f:
        json.dump(config, f)
    with open(os.path.join(main, "db", "migrations", "0001.py"), "w") as f:
        f.write("# applied\n")
    sh(main, "git", "init", "-q", "-b", "main")
    sh(main, "git", "add", ".")
    sh(main, "git", "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "-m", "start")
    clone = os.path.join(main, "lanes", "acme-dev")
    sh(main, "git", "clone", "-q", main, clone)
    sh(clone, "git", "switch", "-q", "-c", "dev/cp1")
    return main, clone


class GuardBase:
    CONFIG = ENGLISH
    NAME = "Acme"

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.main, cls.clone = make_project(cls.tmp.name, cls.NAME, cls.CONFIG)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def call(self, tool, tool_input, cwd):
        r = subprocess.run([sys.executable, GUARD], input=json.dumps(
            {"tool_name": tool, "tool_input": tool_input, "cwd": cwd}), capture_output=True, text=True)
        return r.returncode, r.stdout, r.stderr

    def bash(self, command, cwd=None):
        return self.call("Bash", {"command": command}, cwd or self.clone)

    def test_a_protected_file_on_main_is_not_modified(self):
        code, _, err = self.call("Edit", {"file_path": "db/migrations/0001.py"}, self.clone)
        self.assertEqual(code, 2)
        self.assertIn("is already on", err)
        self.assertEqual(self.bash("sed -i '' s/a/b/ db/migrations/0001.py")[0], 2)
        self.assertEqual(self.bash("echo x > db/migrations/0001.py")[0], 2)

    def test_a_clone_without_configuration_is_protected_anyway(self):
        # A clone at a commit from before the method: the configuration is only in the main folder.
        old = os.path.join(self.main, "lanes", "acme-old")
        sh(self.main, "git", "clone", "-q", self.main, old)
        os.remove(os.path.join(old, ".claude", "metodo.json"))
        code, _, err = self.call("Edit", {"file_path": "db/migrations/0001.py"}, old)
        self.assertEqual(code, 2)
        self.assertIn("db/migrations/0001.py", err)

    def test_a_new_one_is_written_and_a_protected_one_is_read(self):
        self.assertEqual(self.call("Write", {"file_path": "db/migrations/0002.py"}, self.clone)[0], 0)
        self.assertEqual(self.bash("cat db/migrations/0001.py")[0], 0)
        self.assertEqual(self.call("Edit", {"file_path": "README.md"}, self.clone)[0], 0)

    def test_compose_that_deletes_volumes_names_its_project(self):
        self.assertEqual(self.bash("docker compose down -v")[0], 2)
        self.assertEqual(self.bash("docker compose -p acme down -v")[0], 2)
        self.assertEqual(self.bash("docker compose -p acme-cp1-iter down -v")[0], 0)
        self.assertEqual(self.bash("COMPOSE_PROJECT_NAME=acme-cp1-mut docker compose down --volumes")[0], 0)
        self.assertEqual(self.bash("docker compose down")[0], 0)

    def test_protected_volumes_prune_and_rmi(self):
        self.assertEqual(self.bash("docker volume rm acme_pgdata")[0], 2)
        self.assertEqual(self.bash("docker volume rm acme-cp1-iter_pgdata")[0], 0)
        self.assertEqual(self.bash("docker image prune -a -f")[0], 2)
        self.assertEqual(self.bash("docker system prune --volumes -f")[0], 2)
        self.assertEqual(self.bash("docker volume prune --all")[0], 2)
        self.assertEqual(self.bash("docker image prune -f")[0], 0)
        self.assertEqual(self.bash("docker rmi -f acme-cp1-iter-api")[0], 2)
        self.assertEqual(self.bash("docker rmi acme-cp1-iter-api")[0], 0)

    def test_release_starts_from_main_folder_on_main_and_asks(self):
        code, out, _ = self.bash("npx gcloud run deploy app", self.main)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "ask")
        code, _, err = self.bash("bash tools/deploy.sh")
        self.assertEqual(code, 2)
        self.assertIn("dev/cp1", err)
        self.assertEqual(self.bash("grep deploy.sh README.md", self.main), (0, "", ""))

    def test_push_only_from_main_folder(self):
        code, out, _ = self.bash("git push origin main", self.main)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "ask")
        code, _, err = self.bash("git push")
        self.assertEqual(code, 2)
        self.assertIn("owner", err)

    def test_outside_projects_it_does_nothing(self):
        outside = os.path.join(self.tmp.name, "other")
        os.makedirs(outside, exist_ok=True)
        self.assertEqual(self.bash("docker compose down -v && docker image prune -a", outside), (0, "", ""))


class GuardEnglish(GuardBase, unittest.TestCase):
    pass


class GuardItalianAliases(GuardBase, unittest.TestCase):
    """The same rules with the old Italian field names in metodo.json."""
    CONFIG = ITALIAN
    NAME = "Acme2"


class Config(unittest.TestCase):
    def test_italian_aliases_become_canonical(self):
        c = normalize(ITALIAN)
        self.assertEqual(c["prefix"], "acme")
        self.assertEqual(c["lanes"][0]["branches"], ["dev/"])
        self.assertEqual(c["protected"]["stacks"], ["acme"])
        self.assertEqual(c["protected"]["folders"], ["db/migrations/"])
        self.assertEqual(c["release"], ITALIAN["rilascio"])

    def test_english_wins_when_both_are_present(self):
        c = normalize({"prefix": "en", "prefisso": "it", "protected": {"stacks": ["a"]},
                       "protetti": {"stack": ["b"], "volumi": ["v"]},
                       "jobs": {"s": {"lane": "x", "binario": "y", "cosa": "z"}}})
        self.assertEqual(c["prefix"], "en")
        self.assertEqual(c["protected"]["stacks"], ["a"])
        self.assertEqual(c["jobs"]["s"], {"lane": "x", "what": "z"})
        self.assertNotIn("protetti", c)

    def test_jobs_and_lane_aliases(self):
        c = normalize({"binari": [{"id": "d", "lavoro": "demo-"}], "lavori": {"s": {"binario": "d", "cosa": "w"}}})
        self.assertEqual(c["lanes"][0]["jobPrefix"], "demo-")
        self.assertEqual(c["jobs"]["s"], {"lane": "d", "what": "w"})


class Delivery(unittest.TestCase):
    """The delivery gate, in English and with the Italian phrases."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.main, cls.clone = make_project(cls.tmp.name, "Acme", ENGLISH)
        cls.tdir = cls.tmp.name

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def transcript(self, final_text, subagent=None, edit_after=False):
        lines = [{"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "a"}}]}}]
        if subagent:
            lines.append({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "Agent", "input": {"subagent_type": subagent}}]}})
        if edit_after:
            lines.append({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "Write", "input": {"file_path": "b"}}]}})
        lines.append({"type": "assistant", "message": {"content": [{"type": "text", "text": final_text}]}})
        path = os.path.join(self.tdir, "t.jsonl")
        with open(path, "w") as f:
            f.write("\n".join(json.dumps(l) for l in lines))
        return path

    def run_gate(self, transcript):
        r = subprocess.run([sys.executable, DELIVERY], input=json.dumps(
            {"cwd": self.clone, "transcript_path": transcript}), capture_output=True, text=True)
        return r.returncode, r.stderr

    def write_done(self, folder, name, text):
        d = os.path.join(self.clone, folder)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "w") as f:
            f.write(text)

    def clear_docs(self):
        sh(self.clone, "git", "clean", "-fdq", "docs")

    def test_a_message_that_is_not_a_delivery_is_let_through(self):
        self.assertEqual(self.run_gate(self.transcript("All done, here is the summary."))[0], 0)

    def test_english_delivery_without_check_or_done_is_stopped(self):
        self.clear_docs()
        code, err = self.run_gate(self.transcript("Delivery of checkpoint 3"))
        self.assertEqual(code, 2)
        self.assertIn("delivery-check", err)
        self.assertIn("Done", err)

    def test_italian_phrases_are_recognized(self):
        self.clear_docs()
        for phrase in ("Consegna del checkpoint 3", "Consegna della correzione C-4"):
            code, err = self.run_gate(self.transcript(phrase))
            self.assertEqual(code, 2, phrase)

    def test_english_and_old_subagent_names_and_a_written_done(self):
        self.clear_docs()
        self.write_done("docs/blocks", "1-calendar.md", "## Checkpoint 3\n**Done:** run 1, output 12 passed\n")
        for sub in ("metodo:delivery-check", "metodo:controllo-consegna"):
            self.assertEqual(self.run_gate(self.transcript("Delivery of checkpoint 3", sub))[0], 0, sub)
        # an edit after the check invalidates it
        self.assertEqual(self.run_gate(self.transcript("Delivery of checkpoint 3", "metodo:delivery-check", True))[0], 2)

    def test_placeholders_do_not_count_and_old_italian_folders_work(self):
        self.clear_docs()
        self.write_done("docs/blocks", "2.md", "<!-- TO FILL -->\n")
        self.assertEqual(self.run_gate(self.transcript("Delivery of x", "delivery-check"))[0], 2)
        self.clear_docs()
        self.write_done("docs/blocchi", "2.md", "lo scrive la sessione di codice\n")
        self.assertEqual(self.run_gate(self.transcript("Delivery of x", "delivery-check"))[0], 2)
        self.write_done("docs/blocchi", "3.md", "**Fatto:** corsa 1, uscita vera\n")
        self.assertEqual(self.run_gate(self.transcript("Consegna del x", "controllo-consegna"))[0], 0)
        self.clear_docs()

    def test_doc_paths_from_config_and_fallback(self):
        self.clear_docs()
        self.assertEqual(doc_paths(self.clone, {}), ("docs/blocks", "docs/corrections.md"))
        self.write_done("docs/blocchi", "x.md", "x")
        self.assertEqual(doc_paths(self.clone, {})[0], "docs/blocchi")
        self.assertEqual(doc_paths(self.clone, {"docs": {"blocks": "plan/blocks", "corrections": "plan/c.md"}}),
                         ("plan/blocks", "plan/c.md"))
        self.clear_docs()


if __name__ == "__main__":
    unittest.main()
