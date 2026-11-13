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


def env(cloud=False, home=None):
    """The hooks' environment: on the desktop unless asked, whatever machine runs the tests."""
    e = {k: v for k, v in os.environ.items() if k != "CLAUDE_CODE_REMOTE"}
    if cloud:
        e["CLAUDE_CODE_REMOTE"] = "true"
    if home:
        e["HOME"] = home
    return e


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

    CLOUD = False

    def call(self, tool, tool_input, cwd, event="PreToolUse"):
        r = subprocess.run([sys.executable, GUARD], input=json.dumps(
            {"tool_name": tool, "tool_input": tool_input, "cwd": cwd, "hook_event_name": event}),
            capture_output=True, text=True, env=env(self.CLOUD, self.tmp.name))
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


def decision(out):
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out else None


class GuardCloud(unittest.TestCase):
    """In the cloud: pushes by branch, and the coding sessions messaged and archived one job at a time."""
    SEND = "mcp__claude-code-remote__send_message"
    ARCHIVE = "mcp__claude-code-remote__archive_session"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.main, self.clone = make_project(self.tmp.name, "Acme", ENGLISH)

    def tearDown(self):
        self.tmp.cleanup()

    call = GuardBase.call
    bash = GuardBase.bash
    CLOUD = True

    def send(self, session, message, delivered=True):
        code, out, err = self.call(self.SEND, {"session_id": session, "message": message}, self.main)
        if code == 0 and delivered:
            self.call(self.SEND, {"session_id": session, "message": message}, self.main, "PostToolUse")
        return code, out, err

    def test_the_job_branch_goes_out_main_asks_the_rest_is_blocked(self):
        self.assertEqual(self.bash("git push -u origin dev/cp1"), (0, "", ""))
        self.assertEqual(self.bash("git push"), (0, "", ""))
        self.assertEqual(self.bash("git push origin HEAD"), (0, "", ""))
        code, out, _ = self.bash("git push origin main")
        self.assertEqual((code, decision(out)), (0, "ask"))
        code, out, _ = self.bash("git push --force origin dev/cp1")
        self.assertEqual((code, decision(out)), (0, "ask"))
        code, out, _ = self.bash("git push origin :dev/cp0")
        self.assertEqual((code, decision(out)), (0, "ask"))
        code, _, err = self.bash("git push origin feature/x")
        self.assertEqual(code, 2)
        self.assertIn("feature/x", err)
        # on main, a bare push is a push to main
        code, out, _ = self.bash("git push", self.main)
        self.assertEqual((code, decision(out)), (0, "ask"))

    def test_release_only_from_main(self):
        code, out, _ = self.bash("gcloud run deploy app", self.main)
        self.assertEqual((code, decision(out)), (0, "ask"))
        self.assertEqual(self.bash("gcloud run deploy app")[0], 2)

    def test_one_session_one_job_and_archive_after_the_close_out(self):
        self.assertEqual(self.send("session_a", "Prompt for C-12\nThe file is …")[0], 0)
        self.assertEqual(self.send("session_a", "Ok for the plan of C-12")[0], 0)
        # archiving before the close-out is blocked
        code, _, err = self.call(self.ARCHIVE, {"session_id": "session_a"}, self.main)
        self.assertEqual(code, 2)
        self.assertIn("Close-out of", err)
        # a second job's prompt to the same session is blocked, in Italian too
        for second in ("Prompt for C-13", "**Prompt della correzione C-13**", "New work: C-13"):
            code, _, err = self.send("session_a", second)
            self.assertEqual(code, 2, second)
            self.assertIn("create_session", err)
        self.assertEqual(self.send("session_a", "## Close-out of C-12")[0], 0)
        code, out, _ = self.call(self.ARCHIVE, {"session_id": "session_a"}, self.main)
        self.assertEqual((code, decision(out)), (0, "ask"))
        self.assertIn("C-12", out)
        # a new session takes the new job
        self.assertEqual(self.send("session_b", "Prompt for C-13")[0], 0)

    def test_it_notes_the_branch_and_the_archive_for_the_lanes_mod(self):
        self.send("session_a", "Prompt for checkpoint 12\nThe prompt is docs/handoffs/dev/cp12/prompt.md on branch dev/cp12, from abc123.")
        self.send("session_a", "## Close-out of checkpoint 12")
        self.call(self.ARCHIVE, {"session_id": "session_a"}, self.main, "PostToolUse")
        with open(os.path.join(self.tmp.name, ".cache", "acme-review", "state", "cloud.json")) as f:
            seen = json.load(f)["session_a"]
        self.assertEqual(seen["branch"], "dev/cp12")
        self.assertEqual(seen["prompt"], "Prompt for checkpoint 12")
        self.assertEqual(seen["last"], "Close-out of checkpoint 12")
        self.assertTrue(seen["archived"])

    def test_an_undelivered_prompt_is_not_counted(self):
        self.assertEqual(self.send("session_a", "Prompt for C-12", delivered=False)[0], 0)
        self.assertEqual(self.send("session_a", "Prompt for C-12")[0], 0)

    def test_an_unknown_session_only_asks(self):
        code, out, _ = self.call(self.ARCHIVE, {"session_id": "session_z"}, self.main)
        self.assertEqual((code, decision(out)), (0, "ask"))
        self.assertIn("cannot tell", out)


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

    def run_gate(self, transcript, cwd=None, cloud=False):
        r = subprocess.run([sys.executable, DELIVERY], input=json.dumps(
            {"cwd": cwd or self.clone, "transcript_path": transcript}), capture_output=True, text=True,
            env=env(cloud))
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

    def test_in_the_cloud_the_lane_branch_makes_the_coding_session(self):
        self.clear_docs()
        # A cloud checkout outside any clones folder, on a lane's branch.
        cloud = os.path.join(self.tdir, "cloud-checkout")
        sh(self.tdir, "git", "clone", "-q", self.main, cloud)
        sh(cloud, "git", "switch", "-q", "-c", "dev/cp2")
        t = self.transcript("Delivery of checkpoint 2")
        self.assertEqual(self.run_gate(t, cloud, cloud=True)[0], 2)
        self.assertEqual(self.run_gate(t, cloud, cloud=False)[0], 0)
        sh(cloud, "git", "switch", "-q", "main")
        self.assertEqual(self.run_gate(t, cloud, cloud=True)[0], 0)

    def test_in_the_cloud_the_delivery_waits_for_the_branch_on_origin(self):
        self.clear_docs()
        cloud = os.path.join(self.tdir, "cloud-push")
        sh(self.tdir, "git", "clone", "-q", self.main, cloud)
        sh(cloud, "git", "switch", "-q", "-c", "dev/cp5")
        os.makedirs(os.path.join(cloud, "docs", "blocks"))
        with open(os.path.join(cloud, "docs", "blocks", "1.md"), "w") as f:
            f.write("## Checkpoint 5\n**Done:** run 1, 12 passed\n")
        t = self.transcript("Delivery of checkpoint 5", "delivery-check")
        # uncommitted
        code, err = self.run_gate(t, cloud, cloud=True)
        self.assertEqual(code, 2)
        self.assertIn("uncommitted", err)
        sh(cloud, "git", "add", ".")
        sh(cloud, "git", "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "-m", "cp5")
        # committed, not pushed
        code, err = self.run_gate(t, cloud, cloud=True)
        self.assertEqual(code, 2)
        self.assertIn("git push -u origin dev/cp5", err)
        # on the desktop the same checkout is not a coding session: nothing is asked
        self.assertEqual(self.run_gate(t, cloud, cloud=False)[0], 0)
        sh(cloud, "git", "push", "-q", "origin", "dev/cp5")
        self.assertEqual(self.run_gate(t, cloud, cloud=True)[0], 0)

    def test_on_the_desktop_a_clone_delivery_does_not_need_a_push(self):
        self.clear_docs()
        self.write_done("docs/blocks", "1.md", "## Checkpoint 3\n**Done:** run 1, output 12 passed\n")
        # the clone's branch dev/cp1 is not on origin, the tree is dirty: on the desktop it does not matter
        self.assertEqual(self.run_gate(self.transcript("Delivery of checkpoint 3", "delivery-check"))[0], 0)
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
