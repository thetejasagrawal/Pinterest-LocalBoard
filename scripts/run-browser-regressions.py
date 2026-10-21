#!/usr/bin/env python3
"""Run the existing synthetic-board fixtures in headless Chrome or Chromium."""

import argparse
import functools
import html
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def find_chrome():
    headless_shells = []
    for cache in [Path.home() / "Library/Caches/ms-playwright", Path.home() / ".cache/ms-playwright"]:
        headless_shells.extend(sorted(cache.glob("chromium_headless_shell-*/*/chrome-headless-shell"), reverse=True))
    candidates = [
        os.environ.get("CHROME_BIN"),
        shutil.which("chrome-headless-shell"),
        *headless_shells,
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise SystemExit("Install Chrome/Chromium or set CHROME_BIN to its executable.")


def fixture_paths():
    paths = [
        "board/",
        "board/?resume=1",
        "board/?resume=mismatch",
        "cancellation/?mode=pack",
        "cancellation/?mode=verify",
        "recommendations/",
        "recommendations/?known=1",
    ]
    source = (ROOT / "qa/tester/recommendations/index.html").read_text()
    modes = sorted(set(re.findall(r'params\.get\("mode"\) === "([^"]+)"', source)))
    paths.extend(f"recommendations/?mode={mode}" for mode in modes)
    return paths


def run_fixture(chrome, base_url, fixture):
    with tempfile.TemporaryDirectory(prefix="localboard-chrome-") as profile:
        command = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-proxy-server",
            "--host-resolver-rules=MAP *.pinimg.com ~NOTFOUND",
            f"--user-data-dir={profile}",
            "--virtual-time-budget=35000",
            "--dump-dom",
            base_url + "/qa/tester/" + fixture,
        ]
        try:
            with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, start_new_session=True) as process:
                try:
                    stdout, stderr = process.communicate(timeout=90)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise
            match = re.search(r'<pre id="result">(.*?)</pre>', stdout, re.S)
            result = json.loads(html.unescape(match.group(1))) if match else {}
            passed = process.returncode == 0 and result.get("passed") is True
            if not passed and not result:
                result = {"error": "No fixture result", "stderr": stderr[-2000:]}
        except (subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            passed, result = False, {"error": str(error)}
    return {"fixture": fixture, "passed": passed, "result": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--filter", default="", help="Run only matching fixture paths")
    parser.add_argument("--jobs", type=int, default=1, help="Concurrent browser processes")
    parser.add_argument("--report", type=Path, help="Optional JSON results file")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("--jobs must be positive")
    paths = [path for path in fixture_paths() if args.filter in path]
    if not paths:
        parser.error("No fixtures matched --filter")
    chrome = find_chrome()
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    results = []
    try:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            for result in pool.map(functools.partial(run_fixture, chrome, base_url), paths):
                results.append(result)
                print(f"{'PASS' if result['passed'] else 'FAIL'} {result['fixture']}", flush=True)
                if not result["passed"]:
                    print(json.dumps(result["result"], indent=2), flush=True)
    finally:
        server.shutdown()
        server.server_close()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(results, indent=2) + "\n")
    passed = sum(result["passed"] for result in results)
    print(f"{passed}/{len(results)} browser regressions passed.", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
