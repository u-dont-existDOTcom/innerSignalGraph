from html.parser import HTMLParser
from html import unescape
from pathlib import Path
import json
import re
import hashlib

src = Path("guides/source-captures/inner-child-guide-2026-09-25.substack.html")
dst = Path("guides/inner-child-guide-2026-09-25.txt")

VOID = {"area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"}

class VisibleAuthorText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.capture = []
        self.blocks = []

    @staticmethod
    def clean(value):
        return re.sub(r"\s+", " ", unescape(value).replace("\xa0", " ")).strip()

    def is_skipped(self):
        return bool(self.stack and self.stack[-1][1])

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        classes = (data.get("class") or "").split()
        inherited = self.is_skipped()
        local_skip = tag in {"script","style","button","svg","audio","video","iframe","picture"}
        local_skip = local_skip or any(x in classes for x in ["youtube-overlay","previewOverlay","buttonContainer","videoOverlay","downloadButton"])
        local_skip = local_skip or any(x in classes for x in ["youtube-wrap","native-audio-embed","native-video-embed"])
        if "digest-post-embed" in classes and not inherited:
            try:
                meta = json.loads(data.get("data-attrs") or "{}")
                for key in ("title","caption"):
                    if meta.get(key):
                        self.blocks.append(self.clean(meta[key]))
            except Exception:
                pass
            local_skip = True

        skipped = inherited or local_skip
        if tag not in VOID:
            self.stack.append((tag, skipped))

        if skipped:
            return
        if tag in {"h1","h2","h3","h4","h5","h6","p","figcaption"}:
            self.capture.append([tag, []])
        elif tag == "br" and self.capture:
            self.capture[-1][1].append(" ")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if self.is_skipped():
            return
        if self.capture:
            self.capture[-1][1].append(data)

    def handle_endtag(self, tag):
        if self.capture and self.capture[-1][0] == tag and not self.is_skipped():
            _, parts = self.capture.pop()
            value = self.clean("".join(parts))
            if value:
                self.blocks.append(value)

        for idx in range(len(self.stack) - 1, -1, -1):
            if self.stack[idx][0] == tag:
                del self.stack[idx:]
                break

parser = VisibleAuthorText()
parser.feed(src.read_text(encoding="utf-8"))
text = "\n\n".join(parser.blocks).strip() + "\n"
dst.write_text(text, encoding="utf-8")
print("blocks", len(parser.blocks))
print("chars", len(text))
print("sha256", hashlib.sha256(text.encode()).hexdigest())
print(text[:500].replace("\n", "\\n"))
