#!/usr/bin/env python3
"""从 wire.jsonl 提取完整对话,生成 Markdown 归档文档。"""
import json, re, datetime, html

WIRE = "/Users/mac/Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/sessions/wd_kimi3d-work_25a1ca725808/conv-10d2e14f0a6937c1c3b29ca8/agents/main/wire.jsonl"
OUT = "/Users/mac/Documents/CJY项目/kimi3d work模拟/对话记录-商大元境CampusTwinX-完整归档.md"

META_RE = re.compile(r'<meta awareness="[^"]*" timestamp="([^"]+)"\s*/>')
ATTACH_RE = re.compile(r'<attachment>(.*?)</attachment>', re.S)

def fmt_time(ms):
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M")

def clean_user_text(raw):
    m = META_RE.search(raw)
    ts = None
    if m:
        ts = m.group(1)
        raw = META_RE.sub("", raw)
    def att_sub(mm):
        try:
            info = json.loads(mm.group(1))
            return f"[附件: {info.get('name', 'image')}]"
        except Exception:
            return "[附件]"
    raw = ATTACH_RE.sub(att_sub, raw)
    return raw.strip(), ts

events = []
with open(WIRE) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        t = o.get("type")
        if t in ("turn.prompt", "turn.steer") and o.get("origin", {}).get("kind") == "user":
            text, ts = clean_user_text("".join(p.get("text", "") for p in o.get("input", []) if p.get("type") == "text"))
            if text:
                events.append((o.get("time", 0), "user", text))
        elif t == "context.append_loop_event":
            ev = o.get("event", {})
            et = ev.get("type")
            if et == "content.part":
                part = ev.get("part", {})
                if part.get("type") == "text" and part.get("text", "").strip():
                    events.append((o.get("time", 0), "assistant", part["text"].strip()))
            elif et == "tool.call":
                name = ev.get("name", "?")
                desc = ev.get("description", "")
                if name == "Agent":
                    desc = ev.get("args", {}).get("description", desc)
                events.append((o.get("time", 0), "tool", f"{name} — {desc}".strip(" —")))

events.sort(key=lambda e: e[0])

# 合并连续的同类片段(assistant 文本常跨 step 分段)
merged = []
for ts, role, text in events:
    if merged and merged[-1][1] == role and role != "tool":
        merged[-1][2] += "\n\n" + text
    else:
        merged.append([ts, role, text])

n_user = sum(1 for _, r, _ in merged if r == "user")
n_asst = sum(1 for _, r, _ in merged if r == "assistant")
n_tool = sum(1 for _, r, _ in merged if r == "tool")

lines = []
lines.append("# 商大元境 · CampusTwin X —— 项目完整对话记录归档\n")
lines.append("> 本文档由会话记录文件自动提取生成,包含从项目开始(2026-07-17)至今的全部用户指令与 AI 回复,以及工具操作摘要。")
lines.append(f"> 统计:用户消息 {n_user} 条 · AI 回复 {n_asst} 段 · 工具操作 {n_tool} 次\n")
lines.append("---")

first_day = None
for ts, role, text in merged:
    day = datetime.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
    if day != first_day:
        lines.append(f"\n## 📅 {day}\n")
        first_day = day
    time_str = fmt_time(ts)
    if role == "user":
        lines.append(f"\n### 🧑 用户 · {time_str}\n")
        lines.append(text + "\n")
    elif role == "assistant":
        lines.append(f"\n### 🤖 Kimi · {time_str}\n")
        lines.append(text + "\n")
    else:
        lines.append(f"- 🔧 `{time_str}` {text}")

with open(OUT, "w") as f:
    f.write("\n".join(lines))
print("events:", len(events), "merged:", len(merged))
print("user:", n_user, "assistant:", n_asst, "tool:", n_tool)
print("wrote:", OUT)
import os
print("size:", os.path.getsize(OUT))
