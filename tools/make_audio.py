"""Generate the app's Korean voice clips from app/content.json with edge-tts.

Usage:  tools/.venv/Scripts/python tools/make_audio.py [--force]
Needs internet only while generating. Existing clips are kept unless --force.
Clip names must match clipList() in app/app.js.
"""
import asyncio, json, sys
from pathlib import Path

import edge_tts

APP = Path(__file__).resolve().parent.parent / "app"


def clips(c):
    for k, t in c["phrases"].items():
        yield f"p-{k}", t
    for a in c["animals"]:
        yield f"a-{a['id']}-name", f"{a['name']}!"
        yield f"a-{a['id']}-sound", a["sound"]
        yield f"a-{a['id']}-where", f"{a['name']} 어디 있어?"
    for w in c["words"]:
        yield f"w-{w['id']}-name", f"{w['name']}!"
        yield f"w-{w['id']}-where", w.get("ask") or f"{w['name']} 어디 있어?"
    for i, n in enumerate(c["numbers"], 1):
        yield f"n{i}", f"{n}!"
    for m in c["actions"]:
        yield f"m-{m['id']}", m["text"]


async def main(force):
    c = json.loads((APP / "content.json").read_text(encoding="utf-8"))
    v = c["voice"]
    out = APP / "audio"
    out.mkdir(exist_ok=True)
    made = 0
    for name, text in clips(c):
        f = out / f"{name}.mp3"
        if f.exists() and not force:
            continue
        await edge_tts.Communicate(text, v["name"], rate=v["rate"], pitch=v["pitch"]).save(str(f))
        made += 1
        print(f"{name}: {text}")
    print(f"generated {made} clip(s) in {out}")


if __name__ == "__main__":
    asyncio.run(main("--force" in sys.argv))
