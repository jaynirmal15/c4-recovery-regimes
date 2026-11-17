#!/usr/bin/env python3
"""Fig. 1: the reversal. LiveKit, media-only outage of 23 s, before and after the client fix.

The plotted values are constants in this file, transcribed from two committed trials of the
c4-recovery-regimes repository:
  before: study/livekit-iso-media-23s-O-20261002T053228-4      (run 1, superseded)
  after : study-r2/livekit-iso-media-23s-O-20261002T161609-20  (run 2)
from result.json (isolation), S.json (driver actions), logs/study/divergence-{all,r2}.json
(server reports, receiver audio) and logs/study/fig1-quality-states.json (the quality states,
decoded from the observers' signalling frames by client/runner/fig1-quality.mjs). Times are
seconds after isolation onset.

The "Quality signal" row spans the interval from the first update in which S's quality is
not excellent to the first later update reporting excellent, split into the states actually
reported. In (a) that is one continuous "lost" state, ended by the rebuilt session's first
"excellent". In (b) it is "lost", then "poor", then "good", returning to excellent at
40.47 s, beyond the plotted range.

When this script is run from the repository (paper/fig1_reversal.py), it first re-derives
the plotted times from those records and stops if any differs from the constants by more
than 0.01 s. Run elsewhere, it skips that check and says so.

What that check does and does not establish:
- It reads the same record fields, with the same definitions, that the constants were
  transcribed from. It guards against a mistyped or drifted constant. It cannot detect a
  wrong choice of field, because the constant and the check would be wrong together.
- It agreed on its first run; no constant and no part of the derivation was adjusted to
  make it pass.
- It covers times, not every plotted value. In particular the rebuild bar is drawn at a
  minimum width for legibility and is NOT to scale: the check compares only the rebuild's
  start. The measured rebuild took 0.43 s, from 28.85 to 29.28 s; at that width the bar
  collides with the marker for the refused restart at 28.65 s.

Reproducibility of the PDF:
- The committed fig1_reversal.pdf was built with matplotlib 3.9.4 on Python 3.9.1.
- The PDF is written without a creation timestamp, so re-running this script reproduces the
  committed file byte for byte ON THAT matplotlib VERSION. That is the whole scope of the
  claim. A different matplotlib version produces a different, equally correct PDF (the
  version is embedded in the file, and font subsetting and layout can differ).
- Unlike the Node.js analysis dependency, which is pinned by package-lock.json, the Python
  dependency is not pinned anywhere in this repository.

usage: python3 paper/fig1_reversal.py     (needs matplotlib; writes fig1_reversal.pdf beside itself)"""
import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams["pdf.fonttype"] = 42  # embed TrueType, not Type 3 (IEEE PDF eXpress rejects Type 3)
matplotlib.rcParams["ps.fonttype"] = 42
import matplotlib.pyplot as plt

BLUE, ORANGE, INK, MUTED, GREY, LIGHT = "#2a78d6", "#eb6834", "#1a1a19", "#5f5e58", "#8f8e86", "#d9d8d2"
T = dict(
    before=dict(title="(a) Before: resume request dropped  →  rebuild",
        outage=(0, 23.14), attempts=[(7.05, 9.07, "ok"), (14.25, 16.27, "ok"), (21.45, 23.47, "fail"), (28.65, 28.66, "refused")],
        rebuild=(28.85, 29.28), request=22.08, left=27.09, joined=29.20, quality=(10.04, 29.27), qstates=[(10.04, "lost")], stale=(0.42, 29.41), wait=(23.47, 28.65)),
    after=dict(title="(b) After: request held and honoured  →  restart",
        outage=(0, 23.12), attempts=[(7.05, 9.07, "ok"), (14.25, 16.27, "ok"), (21.45, 23.47, "fail"), (23.65, 25.67, "ok")],
        rebuild=None, request=22.08, left=None, joined=None, quality=(10.47, 40.47), qstates=[(10.47, "lost"), (25.47, "poor"), (30.47, "good")], stale=(0.43, 27.19), wait=None),
)


def verify():
    """Re-derive the constants in T from the committed records, when they are available."""
    import json, os
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = {"before": ("study", "livekit-iso-media-23s-O-20261002T053228-4", "logs/study/divergence-all.json"),
           "after": ("study-r2", "livekit-iso-media-23s-O-20261002T161609-20", "logs/study/divergence-r2.json")}
    if not os.path.isdir(os.path.join(root, "study")):
        print("records not found beside this script: constants not re-checked"); return
    bad = []
    def chk(name, got, want):
        if (got is None) != (want is None) or (got is not None and abs(got - want) > 0.01): bad.append(f"{name}: records {got} vs constant {want}")
    for key, (top, tid, divf) in src.items():
        d = T[key]; tdir = os.path.join(root, top, tid)
        res = json.load(open(os.path.join(tdir, "result.json"))); S = json.load(open(os.path.join(tdir, "S.json")))
        t0 = res["iso"]["onset"]["after"]; rel = lambda t: (t - t0) / 1000
        chk(f"{key} outage end", rel(res["iso"]["restore"]["after"]), d["outage"][1])
        acts = S["driver"]["actions"]; restarts = [a for a in acts if a["kind"] == "transport_restart"]; rebuilds = [a for a in acts if a["kind"] == "rebuild"]
        chk(f"{key} restart count", float(len(restarts)), float(len(d["attempts"])))
        for a, (ts, te, outcome) in zip(restarts, d["attempts"]):
            chk(f"{key} restart start", rel(a["tStart"]), ts); chk(f"{key} restart end", rel(a["tEnd"]), te)
            got = "ok" if a["result"].get("ok") else "refused" if a["result"].get("refused") else "fail"
            if got != outcome: bad.append(f"{key} restart outcome: records {got} vs constant {outcome}")
        chk(f"{key} rebuild start", rel(rebuilds[0]["tStart"]) if rebuilds else None, d["rebuild"][0] if d["rebuild"] else None)
        row = next(r for r in json.load(open(os.path.join(root, divf))) if r["id"] == tid); L = row["layers"]
        chk(f"{key} resume request", L["B_subject"]["down"], d["request"])
        chk(f"{key} membership left", L["A_membership"]["down"], d["left"]); chk(f"{key} membership joined", L["A_membership"]["up"], d["joined"])
        chk(f"{key} quality onset", L["B_obs_quality"]["down"], d["quality"][0]); chk(f"{key} quality clear", L["B_obs_quality"]["up"], d["quality"][1])
        qs = json.load(open(os.path.join(root, "logs/study/fig1-quality-states.json")))[key]["observers"]
        for w in ("O1", "O2"):
            got = [(u["t"], u["quality"].lower()) for u in qs[w] if u["quality"] != "EXCELLENT"]
            if len(got) != len(d["qstates"]): bad.append(f"{key} {w} quality states: records {got} vs constants {d['qstates']}"); continue
            for (gt, gq), (ct, cq) in zip(got, d["qstates"]):
                chk(f"{key} {w} quality state time", gt, ct)
                if gq != cq: bad.append(f"{key} {w} quality state: records {gq} vs constant {cq}")
        chk(f"{key} stale from", row["truth"]["down"], d["stale"][0]); chk(f"{key} fresh at", row["truth"]["up"], d["stale"][1])
    if bad: raise SystemExit("constants differ from the committed records:\n  " + "\n  ".join(bad))
    print("constants match the committed records")


verify()
ROWS = ["Network", "Client actions", "Server → client", "Membership", "Quality signal", "Observer audio"]
XMAX = 34
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 6.5, "axes.linewidth": 0.5})
fig, axes = plt.subplots(2, 1, figsize=(3.5, 4.0), sharex=True)
for ax, key in zip(axes, ["before", "after"]):
    d = T[key]; y = {r: len(ROWS) - 1 - i for i, r in enumerate(ROWS)}; h = 0.46
    bar = lambda row, a, b, **kw: ax.barh(y[row], min(b, XMAX) - a, left=a, height=h, **kw)
    bar("Network", *d["outage"], color=GREY, edgecolor="none")
    ax.text(sum(d["outage"]) / 2, y["Network"], "media path blocked, 23 s", ha="center", va="center", color="white", fontsize=6)
    for a, b, res in d["attempts"]:
        if res == "refused":
            ax.plot([a], [y["Client actions"]], marker="x", color=BLUE, ms=4.5, mew=1.1, zorder=3)
        else:
            bar("Client actions", a, b, color=BLUE if res == "ok" else "white", edgecolor=BLUE, linewidth=0.8, hatch=None if res == "ok" else "////")
    if d["wait"]:
        ax.annotate("", xy=(d["wait"][1] - 0.1, y["Client actions"] + 0.36), xytext=(d["wait"][0] + 0.1, y["Client actions"] + 0.36), arrowprops=dict(arrowstyle="<->", color=MUTED, lw=0.6))
        ax.text(sum(d["wait"]) / 2, y["Client actions"] + 0.44, "5 s retry wait", ha="center", va="bottom", color=MUTED, fontsize=5.5)
    if d["rebuild"]:
        bar("Client actions", d["rebuild"][0], d["rebuild"][0] + 0.9, color=ORANGE, edgecolor="none")
    ax.plot([d["request"]], [y["Server → client"]], marker="v", color=ORANGE, ms=4.5, zorder=3)
    ax.text(d["request"] - 0.6, y["Server → client"], "“please resume”", ha="right", va="center", color=INK, fontsize=5.5)
    if d["left"]:
        ax.plot([d["left"], d["joined"]], [y["Membership"]] * 2, ls="none", marker="D", color=ORANGE, ms=3.6, zorder=3)
        ax.text(d["left"] - 0.6, y["Membership"], "left", ha="right", va="center", color=INK, fontsize=5.5)
        ax.text(d["joined"] + 0.6, y["Membership"], "joined", ha="left", va="center", color=INK, fontsize=5.5)
    else:
        ax.text(XMAX / 2, y["Membership"], "no report", ha="center", va="center", color=MUTED, fontsize=5.5, style="italic")
    # the quality interval, first non-excellent update to return to excellent, split into the reported states
    edges = [t for t, _ in d["qstates"]] + [d["quality"][1]]
    for (ts, name), te in zip(d["qstates"], edges[1:]):
        bar("Quality signal", ts, te, color="white", edgecolor=ORANGE, linewidth=0.8)
        ax.text((ts + min(te, XMAX)) / 2, y["Quality signal"], name, ha="center", va="center", color=INK, fontsize=5.5)
    if d["quality"][1] > XMAX:
        ax.text(XMAX, y["Quality signal"] - 0.4, "excellent again at %.1f s" % d["quality"][1], ha="right", va="center", color=MUTED, fontsize=5.2, style="italic")
    bar("Observer audio", *d["stale"], color=LIGHT, edgecolor=MUTED, linewidth=0.5)
    ax.text(sum(d["stale"]) / 2, y["Observer audio"], f"stale until {d['stale'][1]:.1f} s", ha="center", va="center", color=INK, fontsize=5.5)
    ax.axvline(d["outage"][1], color=MUTED, lw=0.5, ls=":", zorder=0)
    ax.set_yticks([y[r] for r in ROWS]); ax.set_yticklabels(ROWS); ax.set_ylim(-0.6, len(ROWS) - 0.2); ax.set_xlim(0, XMAX)
    ax.set_title(d["title"], loc="left", fontsize=6.5, pad=3, color=INK)
    for s in ("top", "right", "left"): ax.spines[s].set_visible(False)
    ax.tick_params(axis="y", length=0, pad=2); ax.tick_params(axis="x", length=2, width=0.5)
    ax.set_axisbelow(True); ax.xaxis.grid(True, color="#ecebe6", lw=0.4)
axes[1].set_xlabel("Time after isolation onset (s)")
# legend for the client-action encodings
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
fig.legend(handles=[Patch(facecolor=BLUE, edgecolor=BLUE, label="restart attempt, completed"), Patch(facecolor="white", edgecolor=BLUE, hatch="////", label="restart attempt, failed"),
                    Line2D([], [], marker="x", color=BLUE, ls="none", ms=4.5, mew=1.1, label="restart refused"), Patch(facecolor=ORANGE, edgecolor=ORANGE, label="rebuild (new session)")],
           loc="lower center", ncol=2, frameon=False, fontsize=5.5, handlelength=1.4, columnspacing=1.0, bbox_to_anchor=(0.5, -0.005))
fig.subplots_adjust(left=0.265, right=0.985, top=0.95, bottom=0.17, hspace=0.3)
import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fig1_reversal")
fig.savefig(out + ".pdf", metadata={"CreationDate": None}); fig.savefig(out + ".png", dpi=300)
print("wrote", out + ".pdf")
