#!/usr/bin/env python3
"""Baut die Vorschau-Seite aus dem Branch ios-preview.

    python3 .claude/skills/ios-preview/build.py <ausgabe-ordner>

Holt den Branch ios-preview (Screenshots + meta.json aus der iOS-CI), legt
<ausgabe>/index.html und <ausgabe>/screens/*.jpg an und gibt meta.json aus.
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(REPO), *args])


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = pathlib.Path(sys.argv[1]).resolve()

    for attempt in range(4):
        try:
            git("fetch", "-q", "origin", "+ios-preview:refs/remotes/origin/ios-preview")
            break
        except subprocess.CalledProcessError:
            if attempt == 3:
                sys.exit("Branch ios-preview nicht gefunden – ist die iOS-CI schon einmal mit Screenshots durchgelaufen?")
            subprocess.run(["sleep", str(2 ** (attempt + 1))])

    with tempfile.TemporaryDirectory() as tmp:
        archive = git("archive", "--format=tar", "origin/ios-preview")
        subprocess.run(["tar", "-x", "-C", tmp], input=archive, check=True)
        src = pathlib.Path(tmp)
        meta = json.loads((src / "meta.json").read_text())

        if out.exists():
            shutil.rmtree(out)
        (out / "screens").mkdir(parents=True)
        for jpg in sorted(src.glob("*.jpg")):
            shutil.copy(jpg, out / "screens" / jpg.name)

    page = (HERE / "template.html").read_text()
    page = page.replace("/*__META__*/{}", json.dumps(meta, ensure_ascii=False).replace("</", "<\\/"))
    (out / "index.html").write_text(page)
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
